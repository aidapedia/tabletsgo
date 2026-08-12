import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/features/auth'
import { useWorkspaces } from '@/features/workspaces'
import { useConnections } from '@/features/connections'
import { useSettings } from '@/features/settings'
import { getDiagram, recordSchemaMigration, runQuery } from '@/shared/api/database'
import { createSchemaDraft, deleteSchemaDraft, getWorkspaceSchema, updateSchemaDraft } from '@/features/schema-designer/lib/api'
import { buildCreateTableSql, emptyLayout, LinkConnectionDialog, schemaSnapshot, UnlinkConnectionDialog, withoutSchemaSnapshot } from '@/features/schema-designer'
import type { LinkCandidate, ReleaseTarget, SchemaDraftDetail, SchemaLayout } from '@/features/schema-designer'
// Deep import, not the `@/features/workspace` barrel: that barrel re-exports
// the whole DB console (QueryEditor pulls CodeMirror in), and this page only
// wants the saved-query write.
import { createSaved, deleteSaved, fetchSaved, updateSaved } from '@/features/workspace/lib/savedQueries'
// The diagram draws one region per table folder, and its node menu edits them —
// so the folders travel with the editor rather than staying in the console.
import {
  TableFolderPickerPanel,
  fetchTableFolders,
  updateTableFolder,
  deleteTableFolder,
  type TableFolder,
} from '@/features/table-folders'
import { draftToItems } from '@/shared/lib/schemaDraft'
import { relativeTime } from '@/shared/lib/recents'
import { useToast } from '@/shared/ui/feedback/Toast'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import Button from '@/shared/ui/buttons/Button'
import Badge from '@/shared/ui/Badge'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import { ChevronLeft, ExternalLinkIcon, LinkIcon, SyncIcon, UnlinkIcon } from '@/shared/ui/icons'

// Same lazy import the console uses — React Flow is heavy, and it should load
// when a diagram is opened, not when the Schema section is.
const SchemaEditor = lazy(() => import('@/features/schema-designer/components/SchemaEditor'))

/**
 * The schema editor page — the diagram's only home, where a draft from the
 * Schema list opens, whichever kind it is.
 *
 * A draft designed against a connection used to open in that connection's
 * console. It doesn't need to, and no longer can: the diagram, the column
 * types, the table folders and the staged DDL all come from per-connection
 * routes that are guarded by connection access alone, so this page draws the
 * live schema itself for anyone who may open that database — and the console's
 * Schema rail icon navigates here rather than opening a tab. It hides Submit —
 * there is no Changes queue here to submit into (see `onStageItems` in
 * SchemaEditor) — and offers Release instead, which runs the staged DDL against
 * the draft's connection directly, after a confirmation listing every
 * statement. The console keeps the data grid, the query editor and the changes
 * queue; what it no longer keeps is a canvas.
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
 * It answers at two addresses. `/schemas/:id` is a draft by id, which is what
 * the Schema list links to. `/schemas/connection/:connectionId` is "the schema
 * editor for this connection" — what the console's rail icon means, where there
 * is a database in hand but no draft id — and it resolves to the same thing:
 * the connection's most recent draft if it has one, otherwise an unsaved
 * canvas over its live tables where Save writes the first draft. Resuming
 * rather than always starting blank is what keeps the icon from stranding
 * staged work behind a list the user didn't ask for.
 *
 * The page is full-screen — it is routed outside `HomeLayout`, so a diagram
 * gets the whole viewport the way the console does instead of a fixed-height
 * box inside the shell's padded scroller. The header strip below is the only
 * chrome, and it carries the way back to the Schema list.
 *
 * The two kinds differ only in `connectionId`, and it decides three things: the
 * `conn` handed to the editor (a real id draws the live tables, a null one
 * leaves the canvas empty and makes `connectionType` the whole dialect), where
 * Save writes — the connection's saved query, or the workspace draft row — and
 * whether there are table folders to draw regions from at all.
 */
// How long ago the schema on the canvas was read. Coarse buckets on purpose — a
// design is not a live dashboard, and "3h ago" says everything "3h 12m ago"
// would; past a day, the date is what someone actually wants to know.
function syncedAgo(at: number, now: number) {
  const mins = Math.max(0, Math.round((now - at) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(at).toLocaleDateString()
}

export default function SchemaDraftPage() {
  // Exactly one of these is set — see the two addresses in the note above.
  const { id, connectionId } = useParams()
  // `?unlink=1` — the Schema list asking for the unlink dialog on arrival. The
  // move needs the canvas that draws the tables it would carry out, so the row
  // sends the question here rather than reimplementing the answer.
  const [searchParams, setSearchParams] = useSearchParams()
  const unlinkRequested = searchParams.get('unlink') === '1'
  const navigate = useNavigate()
  const toast = useToast()
  const { current } = useWorkspaces()
  // The signed-in person, for the audit trail: a save the page just made is
  // theirs, and stamping it locally is what keeps the header honest without a
  // refetch (the row on the server carries the same id — see `persist`).
  const { user } = useAuth()
  const { connections, loading: connectionsLoading, patchLocalConnection } = useConnections()
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
  const [syncing, setSyncing] = useState(false) // "sync schema" — re-read the linked database
  // The connection's live tables, read when the unlink dialog opens: they are
  // what the draft would stop drawing, and what it can take with it as DDL.
  const [liveTables, setLiveTables] = useState<any[] | null>(null)
  // The editor's `currentLayout`, published for the one action that isn't the
  // editor's own — see `layoutRef` in SchemaEditor.
  const layoutRef = useRef<(() => SchemaLayout) | null>(null)
  // The connection's table folders — the regions the canvas draws around its
  // tables. A from-scratch draft has no connection and so no folders; the
  // design's own groups stand in (see `designGroups` in SchemaEditor).
  const [tableFolders, setTableFolders] = useState<TableFolder[]>([])
  const [folderPickerTable, setFolderPickerTable] = useState<string | null>(null)

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

  /**
   * The connection address: no draft id, just a database.
   *
   * Its drafts are that connection's saved queries, so one read answers both
   * halves. With a draft, this *redirects* — replacing the history entry, so
   * Back leaves the editor rather than bouncing through the resolver — and the
   * page then loads it through the effect above like any other. Without one,
   * there is nothing to load: the draft is synthesized in memory with no id,
   * which is precisely what makes the editor show "Save" as "name it and create
   * the first draft" (`draftId` decides that — see SchemaEditor).
   *
   * `connections` is what says the id is real and reachable, so this waits for
   * that list rather than treating "not loaded yet" as "no such connection".
   */
  useEffect(() => {
    if (!connectionId || connectionsLoading) return
    const own = (connections || []).find((c: any) => c.id === connectionId)
    if (!own) {
      toast.error('That connection could not be opened')
      navigate('/schemas', { replace: true })
      return
    }
    let alive = true
    setLoading(true)
    fetchSaved(connectionId).then((list: any[]) => {
      if (!alive) return
      const newest = (list || [])
        .filter((q) => q.kind === 'schema')
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))[0]
      if (newest) return navigate(`/schemas/${newest.id}`, { replace: true })
      setDraft({
        id: '', // unsaved: there is no row behind this canvas yet
        name: 'Untitled schema',
        sql: '',
        layout: null,
        ts: Date.now(),
        // No row means no trail yet — but whoever is looking at this canvas is
        // who Save will record, so the header says so rather than "Unknown".
        createdAt: Date.now(),
        createdBy: user?.id || null,
        createdByName: user?.name || null,
        updatedBy: user?.id || null,
        updatedByName: user?.name || null,
        connectionId,
        connectionName: own.name,
        connectionType: own.type,
      })
      setPending([])
      setLoading(false)
    })
    return () => {
      alive = false
    }
    // `connections` is deliberately not a dep: the context hands back a fresh
    // array identity on each render, and re-running this would re-read the
    // saved queries every time. `connectionsLoading` flips exactly when the
    // list arrives, which is the only change that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, connectionsLoading])

  // Table folders belong to the connection, so a from-scratch draft simply has
  // none — and re-reads when a link or unlink changes which connection it is.
  useEffect(() => {
    const cid = draft?.connectionId
    if (!cid) return setTableFolders([])
    let alive = true
    fetchTableFolders(cid).then((list: TableFolder[]) => alive && setTableFolders(list))
    return () => {
      alive = false
    }
  }, [draft?.connectionId])

  // Edit/delete a folder from the diagram's region menu (optimistic locally,
  // the same way the console's sidebar does it).
  const updateFolderById = async (folderId: string, fields: Partial<TableFolder>) => {
    if (!draft?.connectionId) return
    setTableFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, ...fields } : f)))
    try {
      await updateTableFolder(draft.connectionId, folderId, fields)
    } catch (error) {
      toast.error(`Couldn't update folder: ${(error as Error)?.message}`)
    }
  }

  // Deleting a folder never deletes tables: the server moves its subfolders and
  // member tables up one level, so re-reading is simpler than mirroring it.
  const removeFolder = async (folderId: string) => {
    const cid = draft?.connectionId
    if (!cid) return
    try {
      await deleteTableFolder(cid, folderId)
      setTableFolders(await fetchTableFolders(cid))
    } catch (error) {
      toast.error(`Couldn't delete folder: ${(error as Error)?.message}`)
    }
  }

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

  // When the schema the canvas draws was last read from the database — 0 until a
  // design has been synced once, which the header says in as many words.
  const syncedAt = draft?.layout?.schema?.syncedAt || 0
  // Re-tick so "synced 5m ago" doesn't sit there saying "just now" an hour
  // later. A minute is as fine-grained as the label gets, so it is the interval.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Write the draft back to wherever it lives. Throws — the callers below decide
  // what a failure reads as. Setting a *new* draft object is also what reloads
  // the diagram: `conn` is memoized on it, and the editor refetches when that
  // identity changes, so a release that created tables draws them straight away.
  const persist = async (sql: string, layout: SchemaLayout) => {
    if (!current?.id || !draft) return
    // The unsaved canvas (`/schemas/connection/:id` with no draft yet) has no
    // row behind it. Setting the draft object anyway is not a no-op: `conn` is
    // memoized on it, so this is what redraws the diagram after a release.
    if (!draft.id) return setDraft({ ...draft, sql, layout })
    // The server stamped this write with the caller and the time; mirroring it
    // here is what moves the header's "updated by" without refetching the draft.
    const stamp = { updatedBy: user?.id || null, updatedByName: user?.name || null }
    if (draft.connectionId) {
      // A connection draft is that connection's saved query; writing it
      // through the route the console uses keeps one owner for the row.
      await updateSaved(draft.connectionId, draft.id, { sql, layout })
      setDraft({ ...draft, sql, layout, ts: Date.now(), ...stamp })
    } else {
      const updated = await updateSchemaDraft(current.id, draft.id, { sql, layout })
      setDraft({ ...draft, sql: updated.sql, layout: updated.layout, ts: updated.ts, ...stamp })
    }
  }

  /**
   * Read the linked database's tables into the draft — the only thing that
   * changes the schema the canvas draws.
   *
   * The diagram is the draft's own, stored with it, so nothing re-reads a
   * database on its own: opening a design shows what was there when you left,
   * and this button is how it catches up. It is a save of the design's other
   * half, so it goes through the same row write with whatever is staged.
   *
   * The read is `strict` — a failed one throws instead of degrading to an empty
   * schema, because the result is *stored*, and writing nothing over a good
   * diagram would lose it. A database that really has no tables still syncs to
   * nothing, which is correct.
   */
  const syncSchema = async () => {
    if (!draft || !conn?.id || syncing) return
    setSyncing(true)
    try {
      const fresh: any = await getDiagram(conn, { strict: true })
      const base = layoutRef.current?.() ?? draft.layout ?? emptyLayout()
      await persist(pending.map((i) => i.sql).join('\n'), { ...base, schema: schemaSnapshot(fresh) })
      const count = fresh?.tables?.length || 0
      // An unsaved canvas has no row to store it in yet — `persist` keeps it in
      // memory and Save is what writes it, so say so rather than imply it stuck.
      toast.success(
        `Synced ${count} table${count === 1 ? '' : 's'} from ${draft.connectionName || 'the database'}${
          draft.id ? '' : ' — save the design to keep it'
        }.`
      )
    } catch (error) {
      toast.error(`Couldn't read the schema: ${(error as Error)?.message || 'the database did not answer'}`)
    } finally {
      setSyncing(false)
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

  // `layoutRef` gives the arrangement as it stands, falling back to what was
  // stored; either can be null, and neither may carry the schema snapshot to a
  // draft with a different database behind it (see withoutSchemaSnapshot).
  const stripSnapshot = (l: SchemaLayout | null) => (l ? withoutSchemaSnapshot(l) : l)

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
   *
   * Link and unlink both write a *new row*, so its audit trail starts here: the
   * design is recorded as created by whoever moved it, not by whoever first drew
   * it. Carrying the original creator across would mean a client naming someone
   * else as the author of a row it is creating, which is not something a route
   * can take on trust — a server-side move is what would preserve it.
   */
  const linkToConnection = async (target: LinkCandidate) => {
    if (!current?.id || !draft || linking) return
    setLinking(true)
    try {
      const sql = pending.map((i) => i.sql).join('\n')
      // The design arrives with no schema of its own — it is about to have a
      // different database behind it, and the new draft reads that one itself.
      const layout = stripSnapshot(layoutRef.current?.() ?? draft.layout)
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
    // What the draft *draws* is its own synced schema, which is what the dialog
    // is counting and what it would carry out as DDL — so that is what it asks
    // for. Only a draft that has never synced still has to read the database.
    const stored = layoutRef.current?.()?.schema
    if (stored?.tables?.length) return setLiveTables(stored.tables)
    const diagram: any = await getDiagram(conn)
    setLiveTables(diagram?.tables || [])
  }

  // Consume the `?unlink=1` arrival: open the dialog once the draft is loaded
  // and turns out to have a connection to leave, then drop the parameter. It is
  // an instruction, not a place — a dialog is transient state, so cancelling it
  // and refreshing should not reopen it. A from-scratch draft ignores it: the
  // list disables the action, and a hand-typed URL has nothing to unlink.
  useEffect(() => {
    if (!unlinkRequested || !draft?.id || !draft.connectionId || unlinkOpen) return
    setSearchParams({}, { replace: true })
    openUnlink()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlinkRequested, draft?.id, draft?.connectionId])

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
      // The tables it drew are carried as DDL above (or deliberately not); the
      // snapshot itself must not travel — there is no database behind a
      // from-scratch draft for it to be a snapshot *of*.
      const layout = stripSnapshot(layoutRef.current?.() ?? draft.layout)
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
      // A release is the one thing that makes the draft's stored schema stale by
      // its own hand — those tables exist now — so it re-reads and stores the
      // result rather than waiting for someone to press Sync. A failed read is
      // not an empty schema: keep the snapshot the draft had (`strict` throws).
      let synced = layout
      if (ran.length) {
        try {
          synced = { ...layout, schema: schemaSnapshot(await getDiagram(conn, { strict: true })) }
        } catch {
          // The DDL ran; the diagram is simply a Sync behind. Nothing to say.
        }
      }
      try {
        await persist(remaining.map((i) => i.sql).join('\n'), synced)
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

  // "Save as" forks a *copy* — a new draft of the same kind (the connection's
  // saved query, or a workspace row keeping the dialect), then this page
  // follows it to its own address.
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
            {/* How fresh the drawn schema is, next to what it is of. Nothing
                re-reads the database on its own any more, so "when was this
                last true" is part of reading the diagram — and a linked design
                that has never synced draws nothing, which is worth saying
                plainly rather than leaving as an empty canvas. */}
            {draft.connectionId ? (
              syncedAt ? (
                <span>· synced {syncedAgo(syncedAt, now)}</span>
              ) : (
                <Badge tone="faint">Not synced</Badge>
              )
            ) : null}
            {/* No row behind the canvas yet — say so, because Save here means
                "create the draft" rather than "update it". */}
            {draft.id ? null : <Badge tone="faint">Not saved</Badge>}
            {/* The audit trail, where the design is: a schema is shared work, so
                "who moved this last, and when" belongs beside the name rather
                than only in the list you came from. Who *started* it changes
                once and is the rarer question, so it rides in the tooltip with
                the exact timestamps the relative times round off. */}
            <Tooltip
              placement="bottom"
              multiline
              label={`Created by ${draft.createdByName || 'an account that no longer exists'} on ${new Date(
                draft.createdAt
              ).toLocaleString()}\nLast saved ${new Date(draft.ts).toLocaleString()}`}
            >
              <span className="cursor-default">
                · updated by {draft.updatedByName || 'someone unknown'} {relativeTime(draft.ts)}
              </span>
            </Tooltip>
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
            {/* Only a linked design has a database to read, which is the whole
                condition: the draft draws its own stored schema, so this is the
                one thing that changes it. */}
            <Tooltip placement="bottom" label={`Sync Schema`}>
              <Button variant="subtle" size="sm" onClick={syncSchema} disabled={syncing} aria-label="Sync schema">
                {/* The icon is the whole button, so it carries the state: it
                    spins while the read is in flight, where a labelled button
                    would have said "Syncing…". */}
                <SyncIcon width={15} height={15} className={`shrink-0 ${syncing ? 'animate-spin' : ''}`} />
              </Button>
            </Tooltip>
            {/* Unlinking *moves* a draft row between tables, so it needs one to
                move — an unsaved canvas is already on its connection and nowhere
                else. */}
            {draft.id ? (
              <Button variant="subtle" size="sm" icon={UnlinkIcon} onClick={openUnlink}>
                Unlink
              </Button>
            ) : null}
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
            folders={tableFolders}
            onUpdateFolder={updateFolderById}
            onDeleteFolder={removeFolder}
            onSetFolder={setFolderPickerTable}
            // Empty on the unsaved canvas, which is what turns Save into
            // "name it and create the first draft" (see SchemaEditor).
            draftId={draft.id || undefined}
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

      {/* Only the diagram's "Move to folder…" opens this — the console's Tables
          sidebar assigns folders by drag and drop. */}
      {folderPickerTable && draft.connectionId && (
        <TableFolderPickerPanel
          connectionId={draft.connectionId}
          table={folderPickerTable}
          folders={tableFolders}
          onChange={setTableFolders}
          onClose={() => setFolderPickerTable(null)}
        />
      )}

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
