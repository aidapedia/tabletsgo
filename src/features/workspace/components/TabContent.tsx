import { lazy, Suspense } from 'react'
import TableView from './TableView'
import SchemaView from './SchemaView'
import FunctionView from './FunctionView'
import QueryHistoryView from './QueryHistoryView'
import SchemaHistoryView from '@/features/schema-designer/components/SchemaHistoryView'
import { RedisKeyView } from '@/features/redis'
import { TemplateDetailView, TEMPLATES } from '@/features/templates'
import { DIALECT } from '../lib/dialect'
import type { ConsoleTab } from '../hooks/useConsoleTabs'

// Lazy — pulls in the (heavy) CodeMirror editor only when a query tab opens.
const QueryEditor = lazy(() => import('./QueryEditor'))
// Lazy — React Flow again; only load when a workflow tab opens.
const WorkflowEditor = lazy(() => import('@/features/workflow/components/WorkflowEditor'))
// Lazy — recharts + react-grid-layout; only load when a dashboard tab opens.
const DashboardView = lazy(() => import('@/features/dashboard/components/DashboardView'))
// Lazy — CodeMirror again; only load on a Redis connection's console tab.
const RedisConsole = lazy(() => import('@/features/redis/components/RedisConsole'))

// Stable identity for unfiltered table tabs — TableView keys effects off `filters`.
const EMPTY_FILTERS: any[] = []

const Loading = ({ what }: { what: string }) => (
  <div className="flex-1 p-8 text-center text-xs text-ink-faint">Loading {what}…</div>
)

type Props = {
  tab: ConsoleTab
  conn: any
  nsConn: any
  connectionId: string
  isRedis: boolean
  /** Bumped whenever a commit changed data underneath — re-keys the data views. */
  dataVersion: number
  /** Bumped whenever a Redis write invalidated the keyspace. */
  keyspaceVersion: number
  queryState: Record<string, any>
  history: { list: any[]; loading: boolean; onRefresh: () => void; onClear: () => void; onDelete: (ids: string[]) => void }
  schemaHistory: { migrations: any[]; loading: boolean; onRefresh: () => void; onRollback: (m: any) => void }
  onStage: (change: any) => void
  onOpenReference: (table: string, column: string, value: any) => void
  onFiltersChange: (key: string, filters: any) => void
  onPersist: (key: string, snapshot: any) => void
  onRan: (entry: any) => void
  onSaveQuery: (sql: string, savedId?: string | null) => void
  onAnalyze: (sql: string) => void
  onNewQuery: (sql?: string) => void
  onKeyspaceMutated: () => void
  onKeyDeleted: (key: string) => void
  onDashboardRenamed: (id: string, name: string) => void
  onTemplateApplied: (res: any) => void
}

/**
 * One pane's body: whatever its focused tab shows.
 *
 * Both panes render through here, so a split mounts two tabs at once — every
 * view is keyed by tab key, so the two never share state. Views that read the
 * live database are keyed by the namespace and `dataVersion` too, which is what
 * makes a committed change or a database switch re-read rather than re-render.
 */
export default function TabContent({
  tab: t,
  conn,
  nsConn,
  connectionId,
  isRedis,
  dataVersion,
  keyspaceVersion,
  queryState,
  history,
  schemaHistory,
  onStage,
  onOpenReference,
  onFiltersChange,
  onPersist,
  onRan,
  onSaveQuery,
  onAnalyze,
  onNewQuery,
  onKeyspaceMutated,
  onKeyDeleted,
  onDashboardRenamed,
  onTemplateApplied,
}: Props) {
  if (!conn || !t) return null
  const nsKey = `${nsConn?.ns?.database}:${nsConn?.ns?.schema}`

  switch (t.kind) {
    case 'table':
      return (
        <TableView
          key={`${t.key}:${dataVersion}:${nsKey}`}
          conn={nsConn}
          table={t.table}
          onChange={onStage}
          onOpenReference={onOpenReference}
          filters={t.filters || EMPTY_FILTERS}
          onFiltersChange={(f: any) => onFiltersChange(t.key, f)}
        />
      )
    case 'schema':
      return <SchemaView key={`${t.key}:${dataVersion}:${nsKey}`} conn={nsConn} table={t.table} />
    case 'function':
      return <FunctionView key={`${t.key}:${nsKey}`} conn={nsConn} name={t.name} />
    case 'query':
      return (
        <Suspense fallback={<Loading what="editor" />}>
          {isRedis ? (
            <RedisConsole
              key={t.key}
              tabKey={t.key}
              conn={nsConn}
              initialCommand={t.sql ?? ''}
              persisted={queryState[t.key]}
              onPersist={onPersist}
              onRan={onRan}
              onSave={(sql: string) => onSaveQuery(sql, t.savedId)}
              onMutated={onKeyspaceMutated}
            />
          ) : (
            <QueryEditor
              key={t.key}
              tabKey={t.key}
              conn={nsConn}
              dialect={DIALECT[conn.type]}
              initialSql={t.sql ?? ''}
              persisted={queryState[t.key]}
              onPersist={onPersist}
              onRan={onRan}
              onSave={(sql: string) => onSaveQuery(sql, t.savedId)}
              onAnalyze={onAnalyze}
            />
          )}
        </Suspense>
      )
    case 'redisKey':
      return (
        <RedisKeyView
          key={`${t.key}:${nsConn?.ns?.database}:${keyspaceVersion}`}
          conn={nsConn}
          redisKey={t.redisKey}
          onRunCommand={onNewQuery}
          onDeleted={onKeyDeleted}
        />
      )
    case 'history':
      return (
        <QueryHistoryView
          history={history.list}
          loading={history.loading}
          onRefresh={history.onRefresh}
          onClear={history.onClear}
          onDelete={history.onDelete}
        />
      )
    case 'schemaHistory':
      return (
        <SchemaHistoryView
          migrations={schemaHistory.migrations}
          loading={schemaHistory.loading}
          dialect={DIALECT[conn.type]}
          onRefresh={schemaHistory.onRefresh}
          onRollback={schemaHistory.onRollback}
        />
      )
    case 'workflow':
      return (
        <Suspense fallback={<Loading what="workflow" />}>
          <WorkflowEditor key={t.key} conn={conn} workflowId={t.workflowId} />
        </Suspense>
      )
    case 'dashboard':
      return (
        <Suspense fallback={<Loading what="dashboard" />}>
          <DashboardView
            key={`${t.key}:${nsKey}`}
            conn={nsConn}
            dashboardId={t.dashboardId}
            onRename={onDashboardRenamed}
          />
        </Suspense>
      )
    case 'template': {
      const tpl = TEMPLATES.find((x: any) => x.id === t.templateId)
      return tpl ? (
        <TemplateDetailView
          key={t.key}
          template={tpl}
          connectionId={connectionId}
          dbType={conn.type}
          onApplied={onTemplateApplied}
        />
      ) : (
        <div className="flex-1 p-8 text-center text-xs text-ink-faint">Template not found.</div>
      )
    }
    default:
      return null
  }
}
