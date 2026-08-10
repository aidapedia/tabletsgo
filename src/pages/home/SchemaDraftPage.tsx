import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useWorkspaces } from '@/features/workspaces'
import { createSchemaDraft, getWorkspaceSchema, updateSchemaDraft } from '@/features/schema-designer/lib/api'
import type { SchemaDraftDetail } from '@/features/schema-designer'
// Deep import, not the `@/features/workspace` barrel: that barrel re-exports
// the whole DB console (QueryEditor pulls CodeMirror in), and this page only
// wants the saved-query write.
import { createSaved, updateSaved } from '@/features/workspace/lib/savedQueries'
import { draftToItems } from '@/shared/lib/schemaDraft'
import { useToast } from '@/shared/ui/feedback/Toast'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import Button from '@/shared/ui/buttons/Button'
import Badge from '@/shared/ui/Badge'
import { ChevronLeft, ExternalLinkIcon } from '@/shared/ui/icons'

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
 * that database. What it deliberately does *not* host is the commit — running
 * DDL belongs to the console's Changes queue, so a connection-linked draft
 * carries an "Open in console" link and the editor hides Submit (no queue to
 * submit into, see `onStageItems` in SchemaEditor).
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

  const [draft, setDraft] = useState<SchemaDraftDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<any[]>([])
  const [saving, setSaving] = useState(false)

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

  const save = async (items: any[]) => {
    if (!current?.id || !draft) return
    setSaving(true)
    // Stored the same way either kind is — statements joined by `;` — so
    // `draftToItems` reads it back whichever table it landed in.
    const sql = items.map((i) => i.sql).join('\n')
    try {
      if (draft.connectionId) {
        // A connection draft is that connection's saved query; writing it
        // through the route the console uses keeps one owner for the row.
        await updateSaved(draft.connectionId, draft.id, { sql })
        setDraft({ ...draft, sql })
      } else {
        const updated = await updateSchemaDraft(current.id, draft.id, { sql })
        setDraft({ ...draft, sql: updated.sql, ts: updated.ts })
      }
      toast.success('Schema saved')
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not save the schema')
    } finally {
      setSaving(false)
    }
  }

  // "Save as" forks a *copy*, the same as it does in the console — a new draft
  // of the same kind (the connection's saved query, or a workspace row keeping
  // the dialect), then this page follows it to its own address.
  const saveAs = async (items: any[], name: string) => {
    if (!current?.id || !draft) return
    const sql = items.map((i) => i.sql).join('\n')
    try {
      const copy: any = draft.connectionId
        ? await createSaved(draft.connectionId, { name, sql, kind: 'schema' })
        : await createSchemaDraft(current.id, { name, dbType: draft.connectionType, sql })
      toast.success(`Saved draft “${name}”.`)
      navigate(`/schemas/${copy.id}`)
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not save the schema')
    }
  }

  if (loading || !draft || !conn) return <LoadingState className="" />

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={() => navigate('/schemas')}>
          Schema Editor
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-bold tracking-[-0.3px]">{draft.name}</h1>
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
          </p>
        </div>
        {/* Running the staged DDL is the console's job — this is the way over. */}
        {draft.connectionId && (
          <Button
            variant="subtle"
            size="sm"
            icon={ExternalLinkIcon}
            onClick={() => navigate(`/connection/${draft.connectionId}?schema=${draft.id}`)}
          >
            Open in console
          </Button>
        )}
      </div>

      {/* A *definite* height, not a minimum: the editor's sidebar sizes its
          accordion with `h-full` + `flex-1`, so every ancestor needs a height a
          percentage can resolve against. The console gets that from `h-screen`;
          this page lives inside HomeLayout's auto-height scroller, so it states
          one — viewport minus the layout's padding and the header above. With a
          minimum instead, the sidebar fell back to content height and the open
          section had no free space to grow into (its neighbours bunched up
          under it instead of sitting at the bottom). */}
      <div className="flex h-[calc(100vh-11rem)] min-h-[420px] flex-col overflow-hidden rounded-card border border-edge bg-panel">
        <Suspense fallback={<LoadingState className="" />}>
          <SchemaEditor
            conn={conn}
            pending={pending}
            onPendingChange={setPending}
            draftId={draft.id}
            onUpdateDraft={(_draftId: string, items: any[]) => save(items)}
            onSaveDraft={(items: any[], name: string) => saveAs(items, name)}
          />
        </Suspense>
      </div>
    </div>
  )
}
