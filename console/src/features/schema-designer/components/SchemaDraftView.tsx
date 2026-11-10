import { lazy, Suspense } from 'react'
import LinkConnectionDialog from './LinkConnectionDialog'
import SyncProgressDialog from './SyncProgressDialog'
import UnlinkConnectionDialog from './UnlinkConnectionDialog'
import type { SchemaLayout } from '../lib/design'
import { TableFolderPickerPanel } from '@/features/table-folders'
import { relativeTime } from '@/shared/lib/recents'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { ChevronLeft, LinkIcon, SyncIcon, UnlinkIcon } from '@/shared/ui/icons'
import useSchemaDraftController from '../hooks/useSchemaDraftController'
import { formatDate, formatDateTime } from '@/shared/lib/datetime'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

// Keep the canvas out of the route chunk until a draft is opened.
const SchemaEditor = lazy(() => import('./SchemaEditor'))

// How long ago the schema on the canvas was read. Coarse buckets on purpose — a
// design is not a live dashboard, and "3h ago" says everything "3h 12m ago"
// would; past a day, the date is what someone actually wants to know.
function syncedAgo(at: number, now: number) {
  const mins = Math.max(0, Math.round((now - at) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return formatDate(at)
}

export default function SchemaDraftView({ connections, connectionsLoading, patchLocalConnection }: {
  connections: { id: string; name: string; type: string }[]
  connectionsLoading: boolean
  patchLocalConnection?: (id: string, fields: Record<string, unknown>) => void
}) {
  const {
    loading, draft, conn, navigate, syncedAt, now, saving, releasing,
    syncSchema, syncing, openUnlink, setLinkOpen, pending, setPending,
    tableFolders, updateFolderById, removeFolder, setFolderPickerTable,
    layoutRef, save, saveAs, releaseTarget, release, folderPickerTable,
    setTableFolders, unlinkOpen, liveTables, unlinking, setUnlinkOpen,
    unlinkFromConnection, linkOpen, linkCandidates, linking,
    linkToConnection, syncProgress,
  } = useSchemaDraftController({ connections, connectionsLoading, patchLocalConnection })

  if (loading || !draft || !conn)
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <LoadingState className="" />
      </div>
    )

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* One header strip, the console's height and gutters — the canvas gets
          everything below it. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-sidebar px-3 py-2">
        {/* An editor, not a page in the shell: no trail, just the way back. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={() => navigate('/schemas')} aria-label="Back to Schema Editor">
              <ChevronLeft width={16} height={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Back to Schema Editor</TooltipContent>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[13px] font-bold tracking-[-0.3px] text-foreground">{draft.name}</h1>
          <p className="flex items-center gap-1.5 text-[11px] text-faint">
            {draft.connectionId ? (
              <>
                <span className="truncate">{draft.connectionName}</span>
                <span>·</span>
              </>
            ) : (
              <Badge variant="faint">From scratch</Badge>
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
                <Badge variant="faint">Not synced</Badge>
              )
            ) : null}
            {/* No row behind the canvas yet — say so, because Save here means
                "create the draft" rather than "update it". */}
            {draft.id ? null : <Badge variant="faint">Not saved</Badge>}
            {/* The audit trail, where the design is: a schema is shared work, so
                "who moved this last, and when" belongs beside the name rather
                than only in the list you came from. Who *started* it changes
                once and is the rarer question, so it rides in the tooltip with
                the exact timestamps the relative times round off. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">
                  · updated by {draft.updatedByName || 'someone unknown'} {relativeTime(draft.ts)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[280px] whitespace-pre-wrap break-words text-left">{`Created by ${draft.createdByName || 'an account that no longer exists'} on ${formatDateTime(
                draft.createdAt
              )}\nLast saved ${formatDateTime(draft.ts)}`}</TooltipContent>
            </Tooltip>
            {saving ? <span>· saving…</span> : null}
            {releasing ? <span className="text-warning">· releasing…</span> : null}
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
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button variant="ghost" size="sm" onClick={() => syncSchema()} disabled={syncing} aria-label="Sync schema">
                    {/* The icon is the whole button, so it carries the state: it
                        spins while the read is in flight, where a labelled button
                        would have said "Syncing…". */}
                    <SyncIcon width={15} height={15} className={`shrink-0 ${syncing ? 'animate-spin' : ''}`} />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">Sync Schema</TooltipContent>
            </Tooltip>
            {/* Unlinking *moves* a draft row between tables, so it needs one to
                move — an unsaved canvas is already on its connection and nowhere
                else. */}
            {draft.id ? (
              <Button variant="ghost" size="sm" onClick={openUnlink}>
                <UnlinkIcon width={15} height={15} />
                Unlink
              </Button>
            ) : null}
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
            <LinkIcon width={15} height={15} />
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
            // Release reads the database before it asks — the same sync as the
            // header button, drawn inside the release dialog instead of under a
            // modal of this page's. See openRelease in SchemaEditor.
            onSyncSchema={syncSchema}
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

      {/* A sync replaces the schema the canvas draws, so it holds the page
          while it runs rather than letting someone edit a diagram that is about
          to be redrawn. It closes itself — there is nothing to decide in it. */}
      {syncProgress && <SyncProgressDialog progress={syncProgress} connectionName={draft.connectionName} />}
    </div>
  )
}
