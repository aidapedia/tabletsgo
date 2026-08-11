import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useWorkspaces } from '@/features/workspaces'
import { useConnections } from '@/features/connections'
import { useSettings } from '@/features/settings'
import { getDiagram, recordSchemaMigration, runQuery } from '@/shared/api/database'
import { createSchemaDraft, deleteSchemaDraft, getWorkspaceSchema, updateSchemaDraft } from '@/features/schema-designer/lib/api'
import { buildCreateTableSql, LinkConnectionDialog, UnlinkConnectionDialog } from '@/features/schema-designer'
import type { LinkCandidate, ReleaseTarget, SchemaDraftDetail, SchemaLayout } from '@/features/schema-designer'
// Deep import, not the `@/features/workspace` barrel: that barrel re-exports
// the whole DB console (QueryEditor pulls CodeMirror in), and this page only
// wants the saved-query write.
import { createSaved, deleteSaved, updateSaved } from '@/features/workspace/lib/savedQueries'
import { draftToItems } from '@/shared/lib/schemaDraft'
import { useToast } from '@/shared/ui/feedback/Toast'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import Button from '@/shared/ui/buttons/Button'
import Badge from '@/shared/ui/Badge'
import { ChevronLeft, ExternalLinkIcon, LinkIcon, UnlinkIcon } from '@/shared/ui/icons'

// Same lazy import the console uses — React Flow is heavy, and it should load
// when a diagram is opened, not when the Schema section is.
const SchemaEditor = lazy(() => import('@/features/schema-designer/components/SchemaEditor'))

/**
 * The schema editor page — where a draft from the Schema list opens, whichever
 * kind it is.
 *
 * A draft designed against a connection used to send you into that connection's
 * console. It doesn't need to: the diagram, the column types and the staged DDL
 * all come from per-connection routes that are guarded by connection access
 * alone, so this page can draw the live schema itself for anyone who may open
 * that database. It hides Submit — there is no Changes queue here to submit
 * into (see `onStageItems` in SchemaEditor) — and offers Release instead, which
 * runs the staged DDL against the draft's connection directly, after a
 * confirmation listing every statement. The "Open in console" link stays for
 * everything else the console does around a commit.
 *
 * A from-scratch draft has no database, so Release is disabled on it and the way
 * forward is "Link to connection": the design moves onto a connection of its own
 * engine and becomes that connection's draft, at which point it releases like
 * any other. Linking rather than picking a database per release is deliberate —
 * the choice is made once, in front of a canvas that then draws that database's
 * live tables, instead of in a dropdown seconds before DDL runs. "Unlink" is the
 * move back, and offers to write the live tables into the design as DDL on the
 * way out, because those tables are drawn by the connection and not stored in
 * the draft. Both directions move a row and touch no database.
 *
 * The page is full-screen — it is routed outside `HomeLayout`, so a diagram
 * gets the whole viewport the way the console does instead of a fixed-height
 * box inside the shell's padded scroller. The header strip below is the only
 * chrome, and it carries the way back to the Schema list.
 *
 * The two kinds differ only in `connectionId`, and it decides two things: the
 * `conn` handed to the editor (a real id draws the live tables, a null one
 * leaves the canvas empty and makes `connectionType` the whole dialect), and
 * where Save writes — the connection's saved query, or the workspace draft row.
 */
export default function SchemaDraftPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { current } = useWorkspaces()
  const { connections, patchLocalConnection } = useConnections()
  const { queryTimeout } = useSettings()

  const [draft, setDraft] = useState<SchemaDraftDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false) // "link to a connection" dialog (from-scratch drafts)
  const [linking, setLinking] = useState(false)
  const [unlinkOpen, setUnlinkOpen] = useState(false) // "unlink" dialog (connection drafts)
  const [unlinking, setUnlinking] = useState(false)
  // The connection's live tables, read when the unlink dialog opens: they are
  // what the draft would stop drawing, and what it can take with it as DDL.
  const [liveTables, setLiveTables] = useState<any[] | null>(null)
  // The editor's `currentLayout`, published for the one action that isn't the
  // editor's own — see `layoutRef` in SchemaEditor.
  const layoutRef = useRef<(() => SchemaLayout) | null>(null)

  useEffect(() => {
    if (!current?.id || !id) return
    let alive = true
    setLoading(true)
    getWorkspaceSchema(current.id, id)
      .then((d) => {
        if (!alive) return
        setDraft(d)
        setPending(draftToItems(d.sql))
        setLoading(false)
      })
      .catch((error) => {
        if (!alive) return
        // A 403 is its own answer — the draft exists, the database behind it is
        // not yours to open — so it reads differently from a missing draft.
        toast.error((error as Error)?.message || 'That schema draft could not be opened')
        navigate('/schemas')
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, id])

  // What the editor asks the backend with. A connection-linked draft passes the
  // real id, so the live tables are drawn and the column types come from that
  // engine; a from-scratch one passes null — "there is no database to ask" —
  // and its stored dialect stands in for the connection's type.
  const conn = useMemo(
    () =>
      draft
        ? { id: draft.connectionId, type: draft.connectionType, name: draft.connectionName || draft.name }
        : null,
    [draft]
  )

  // Write the draft back to wherever it lives. Throws — the callers below decide
  // what a failure reads as. Setting a *new* draft object is also what reloads
  // the diagram: `conn` is memoized on it, and the editor refetches when that
  // identity changes, so a release that created tables draws them straight away.
  const persist = async (sql: string, layout: SchemaLayout) => {
    if (!current?.id || !draft) return
    if (draft.connectionId) {
      // A connection draft is that connection's saved query; writing it
      // through the route the console uses keeps one owner for the row.
      await updateSaved(draft.connectionId, draft.id, { sql, layout })
      setDraft({ ...draft, sql, layout })
    } else {
      const updated = await updateSchemaDraft(current.id, draft.id, { sql, layout })
      setDraft({ ...draft, sql: updated.sql, layout: updated.layout, ts: updated.ts })
    }
  }

  // The DDL and the arrangement are one save: a diagram is where its tables sit
  // and what is written beside them as much as it is the statements it stages.
  const save = async (items: any[], layout: SchemaLayout) => {
    if (!current?.id || !draft) return
    setSaving(true)
    try {
      // Stored the same way either kind is — statements joined by `;` — so
      // `draftToItems` reads it back whichever table it landed in.
      await persist(items.map((i) => i.sql).join('\n'), layout)
      toast.success('Schema saved')
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not save the schema')
    } finally {
      setSaving(false)
    }
  }

  // Where this design releases: the database it was designed against, and only
  // that one. A from-scratch draft has none — it belongs to the workspace, not
  // to a database — so it has nothing to release to until it is linked to a
  // connection, and the editor shows Release disabled with that as the reason.
  const releaseTarget = useMemo<ReleaseTarget | null>(() => {
    if (!draft?.connectionId) return null
    const own = (connections || []).find((c: any) => c.id === draft.connectionId)
    return { id: draft.connectionId, name: draft.connectionName || own?.name || 'this connection', type: draft.connectionType }
  }, [draft, connections])

  // The connections a from-scratch design may be linked to: same engine only —
  // its DDL was generated for that dialect, so another engine is a different
  // language rather than a different address.
  const linkCandidates = useMemo<LinkCandidate[]>(
    () =>
      draft && !draft.connectionId
        ? (connections || []).filter((c: any) => c.type === draft.connectionType).map((c: any) => ({ id: c.id, name: c.name, type: c.type }))
        : [],
    [draft, connections]
  )

  /**
   * Give a from-scratch design a database.
   *
   * The two kinds of draft live in different tables — a workspace row versus
   * that connection's saved query — so linking is a move, not a flag: the
   * design is written to the connection (statements, notes, arrangement and
   * all), the workspace row is dropped, and the page follows it to its new
   * address. Its id changes, which is why this navigates rather than patching
   * state in place.
   *
   * The copy is written before the original is dropped, so a failure halfway
   * leaves the design where it was rather than nowhere.
   */
  const linkToConnection = async (target: LinkCandidate) => {
    if (!current?.id || !draft || linking) return
    setLinking(true)
    try {
      const sql = pending.map((i) => i.sql).join('\n')
      const layout = layoutRef.current?.() ?? draft.layout
      const copy: any = await createSaved(target.id, { name: draft.name, sql, kind: 'schema', layout })
      await deleteSchemaDraft(current.id, draft.id)
      setLinkOpen(false)
      toast.success(`“${draft.name}” is now a schema draft on ${target.name}.`)
      navigate(`/schemas/${copy.id}`)
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not link the design to that connection')
    } finally {
      setLinking(false)
    }
  }

  // Open the unlink dialog, reading the connection's tables behind it — the
  // dialog needs to say how many it is offering to keep, and the confirm needs
  // their columns to rebuild them as DDL. Read once, on open, rather than held
  // for a move that most sessions never make.
  const openUnlink = async () => {
    if (!conn?.id) return
    setLiveTables(null)
    setUnlinkOpen(true)
    const diagram: any = await getDiagram(conn)
    setLiveTables(diagram?.tables || [])
  }

  /**
   * Cut the draft loose from its connection — the reverse move of
   * `linkToConnection`, and for the same reason a move rather than a flag.
   *
   * The asymmetry is what `keepTables` is for. A linked draft draws the live
   * tables *and* its staged DDL; only the second half is stored in the draft, so
   * unlinking as-is quietly leaves a canvas with the staged statements alone.
   * Checked (the default), every live table is written into the design as the
   * CREATE TABLE that would rebuild it — placed before the staged statements,
   * which is also the order they would run in — so the from-scratch draft opens
   * as the same diagram. The arrangement travels either way, and because layout
   * is keyed by table name, each rebuilt table lands where the live one sat.
   *
   * The database is never touched: this writes a workspace row and drops a saved
   * query. The connection keeps its tables, its schema version and its history.
   */
  const unlinkFromConnection = async (keepTables: boolean) => {
    if (!current?.id || !draft?.connectionId || unlinking) return
    setUnlinking(true)
    try {
      const carried = keepTables ? (liveTables || []).map((t: any) => buildCreateTableSql(t.name, t.columns || [])) : []
      const sql = [...carried, ...pending.map((i) => i.sql)].join('\n')
      const layout = layoutRef.current?.() ?? draft.layout
      const copy = await createSchemaDraft(current.id, { name: draft.name, dbType: draft.connectionType, sql, layout })
      await deleteSaved(draft.connectionId, draft.id)
      setUnlinkOpen(false)
      toast.success(`“${draft.name}” is now a from-scratch draft of this workspace.`)
      navigate(`/schemas/${copy.id}`)
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not unlink the design from its connection')
    } finally {
      setUnlinking(false)
    }
  }

  /**
   * Run the staged DDL against the draft's connection — the console's commit,
   * without the console.
   *
   * Statements run in order and stop at the first failure, so what survives is a
   * prefix that really ran; those are recorded as one migration on the
   * connection (bumping its schema version), which is what makes a release
   * rollback-able from that connection's schema history like any other commit.
   *
   * What ran then leaves the draft: those tables exist in the database now, and
   * the editor draws the live schema, so keeping them staged would only offer to
   * create them a second time. The arrangement is saved with what's left — the
   * layout is keyed by table name, so every released table comes back exactly
   * where it was placed, now drawn as a real one.
   */
  const release = async (items: any[], layout: SchemaLayout) => {
    const target = releaseTarget
    if (!draft || !target || releasing) return
    const statements = items.filter((i) => (i.sql || '').trim())
    if (!statements.length) return
    setReleasing(true)
    // Only the id and type matter to the query route; no namespace is selected
    // here, so a release lands on the connection's default database/schema.
    const targetConn = { id: target.id, type: target.type }
    const ran: any[] = []
    let failure: string | null = null
    try {
      for (const item of statements) {
        const res: any = await runQuery(targetConn, item.sql, { timeoutMs: queryTimeout * 1000 })
        if (res?.error) {
          failure = res.error
          break
        }
        ran.push(item)
      }

      // One migration row for the batch that actually ran. Items carry a
      // rollbackSql only where the editor could build one, so a release is
      // reversible exactly when every statement in it was.
      if (ran.length) {
        try {
          const { version } = await recordSchemaMigration(
            targetConn,
            ran.map((i) => ({ sql: i.sql, rollbackSql: i.rollbackSql ?? null, reversible: !!i.rollbackSql, label: i.table ? `${i.mode || 'ddl'} ${i.table}` : 'schema' }))
          )
          patchLocalConnection?.(target.id, { schemaVersion: version })
        } catch (error) {
          toast.error(`Released, but couldn't record the migration: ${(error as Error)?.message}`)
        }
      }

      const remaining = statements.slice(ran.length)
      try {
        await persist(remaining.map((i) => i.sql).join('\n'), layout)
        setPending(remaining)
      } catch (error) {
        // The database took the statements either way — say so rather than let a
        // failed draft write read as a failed release.
        toast.error(`Released, but the draft could not be updated: ${(error as Error)?.message}`)
      }
    } finally {
      setReleasing(false)
    }

    if (failure) toast.error(`Released ${ran.length} of ${statements.length} statements to ${target.name}, then failed: ${failure}`)
    else toast.success(`Released ${ran.length} statement${ran.length === 1 ? '' : 's'} to ${target.name}.`)
  }

  // "Save as" forks a *copy*, the same as it does in the console — a new draft
  // of the same kind (the connection's saved query, or a workspace row keeping
  // the dialect), then this page follows it to its own address.
  const saveAs = async (items: any[], name: string, layout: SchemaLayout) => {
    if (!current?.id || !draft) return
    const sql = items.map((i) => i.sql).join('\n')
    try {
      const copy: any = draft.connectionId
        ? await createSaved(draft.connectionId, { name, sql, kind: 'schema', layout })
        : await createSchemaDraft(current.id, { name, dbType: draft.connectionType, sql, layout })
      toast.success(`Saved draft “${name}”.`)
      navigate(`/schemas/${copy.id}`)
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not save the schema')
    }
  }

  if (loading || !draft || !conn)
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <LoadingState className="" />
      </div>
    )

  return (
    <div className="flex h-screen flex-col bg-bg">
      {/* One header strip, the console's height and gutters — the canvas gets
          everything below it. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-edge bg-panel px-3 py-2">
        <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={() => navigate('/schemas')}>
          Schema Editor
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[13px] font-bold tracking-[-0.3px]">{draft.name}</h1>
          <p className="flex items-center gap-1.5 text-[11px] text-ink-faint">
            {draft.connectionId ? (
              <>
                <span className="truncate">{draft.connectionName}</span>
                <span>·</span>
              </>
            ) : (
              <Badge tone="faint">From scratch</Badge>
            )}
            <span>{draft.connectionType}</span>
            {saving ? <span>· saving…</span> : null}
            {releasing ? <span className="text-amber">· releasing…</span> : null}
          </p>
        </div>
        {/* A from-scratch design has no database yet, so the way forward is a
            connection rather than the console. Once it has one, Release runs the
            DDL from here and the console is still where the data, the query
            editor and the changes queue live. */}
        {draft.connectionId ? (
          <>
            <Button variant="subtle" size="sm" icon={UnlinkIcon} onClick={openUnlink}>
              Unlink
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" icon={LinkIcon} onClick={() => setLinkOpen(true)}>
            Link to connection
          </Button>
        )}
      </div>

      {/* The editor's sidebar sizes its accordion with `h-full` + `flex-1`, so
          every ancestor needs a height a percentage can resolve against — that
          now comes from the page's own `h-screen`, the same way the console
          gets it, rather than the viewport-minus-chrome height this box used to
          state while it lived inside HomeLayout's scroller. `min-h-0` is what
          keeps the flex child from refusing to shrink below its content. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Suspense fallback={<LoadingState className="" />}>
          <SchemaEditor
            conn={conn}
            pending={pending}
            onPendingChange={setPending}
            draftId={draft.id}
            layout={draft.layout}
            layoutRef={layoutRef}
            onUpdateDraft={(_draftId: string, items: any[], layout: SchemaLayout) => save(items, layout)}
            onSaveDraft={(items: any[], name: string, layout: SchemaLayout) => saveAs(items, name, layout)}
            releaseTarget={releaseTarget}
            releaseHint="Link this design to a connection first — Release runs its statements against a database"
            releasing={releasing}
            onRelease={release}
          />
        </Suspense>
      </div>

      {unlinkOpen && (
        <UnlinkConnectionDialog
          draftName={draft.name}
          connectionName={draft.connectionName || 'its connection'}
          liveTables={liveTables}
          unlinking={unlinking}
          onCancel={() => !unlinking && setUnlinkOpen(false)}
          onConfirm={unlinkFromConnection}
        />
      )}

      {linkOpen && (
        <LinkConnectionDialog
          draftName={draft.name}
          dialect={draft.connectionType}
          candidates={linkCandidates}
          linking={linking}
          onCancel={() => !linking && setLinkOpen(false)}
          onConfirm={linkToConnection}
        />
      )}
    </div>
  )
}
