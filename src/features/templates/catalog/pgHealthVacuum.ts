// Ported from the former src/features/dashboard/examples/ prototype pair
// (pg-health-vacuum.dashboard.json + vacuum-table.workflow.json).
import type { Template } from '../types'

export const pgHealthVacuum: Template = {
  id: 'pg-health-vacuum',
  name: 'PostgreSQL Health & Vacuum',
  description:
    'Connection and cache-hit metrics, table/index storage sizes, and vacuum health with a one-click per-table Vacuum action wired to a bundled workflow. Also surfaces unused indexes.',
  databases: ['postgresql'],
  workflows: [
    {
      key: 'vacuum-table',
      name: 'Vacuum Table',
      graph: {
        nodes: [
          { id: 'trigger', type: 'manual', position: { x: 80, y: 140 }, data: {} },
          {
            id: 'vacuum',
            type: 'query',
            position: { x: 400, y: 140 },
            data: {
              title: 'Vacuum selected table',
              sql: 'VACUUM (ANALYZE) {{input.schemaname:ident}}.{{input.relname:ident}}',
            },
          },
        ],
        edges: [{ id: 'e-trigger-vacuum', source: 'trigger', target: 'vacuum', sourceHandle: 'out' }],
      },
    },
  ],
  dashboards: [
    {
      name: 'PostgreSQL Health',
      config: {
        variables: [],
        widgets: [
          {
            id: 'w-connections',
            type: 'metric',
            title: 'Connections',
            unit: '%',
            query: "SELECT round(100.0 * count(*) / current_setting('max_connections')::int) FROM pg_stat_activity",
            layout: { x: 0, y: 0, w: 3, h: 3 },
          },
          {
            id: 'w-active',
            type: 'metric',
            title: 'Active',
            query: "SELECT count(*) FROM pg_stat_activity WHERE state = 'active'",
            layout: { x: 3, y: 0, w: 3, h: 3 },
          },
          {
            id: 'w-idle-txn',
            type: 'metric',
            title: 'Idle in Txn',
            query: "SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'",
            layout: { x: 6, y: 0, w: 3, h: 3 },
          },
          {
            id: 'w-cache-hit',
            type: 'metric',
            title: 'Cache Hit',
            unit: '%',
            query:
              'SELECT round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0)) FROM pg_stat_database',
            layout: { x: 9, y: 0, w: 3, h: 3 },
          },

          {
            id: 'w-tables-head',
            type: 'text',
            title: '',
            text: '## Tables & Storage',
            layout: { x: 0, y: 3, w: 12, h: 1 },
          },
          {
            id: 'w-db-size',
            type: 'metric',
            title: 'Database',
            query: 'SELECT pg_size_pretty(pg_database_size(current_database()))',
            layout: { x: 0, y: 4, w: 4, h: 3 },
          },
          {
            id: 'w-tables-size',
            type: 'metric',
            title: 'Tables',
            query:
              "SELECT pg_size_pretty(COALESCE(sum(pg_table_size(c.oid)), 0)) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')",
            layout: { x: 4, y: 4, w: 4, h: 3 },
          },
          {
            id: 'w-idx-size',
            type: 'metric',
            title: 'Indexes',
            query:
              "SELECT pg_size_pretty(COALESCE(sum(pg_indexes_size(c.oid)), 0)) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')",
            layout: { x: 8, y: 4, w: 4, h: 3 },
          },
          {
            id: 'w-tables-list',
            type: 'table',
            title: 'Largest Tables',
            pageSize: 10,
            query:
              'SELECT relname AS table, n_live_tup AS rows, pg_size_pretty(pg_table_size(relid)) AS data, pg_size_pretty(pg_indexes_size(relid)) AS indexes, seq_scan AS seq_scans, idx_scan AS idx_scans FROM pg_stat_user_tables ORDER BY pg_table_size(relid) DESC',
            layout: { x: 0, y: 7, w: 12, h: 7 },
          },

          {
            id: 'w-vacuum-head',
            type: 'text',
            title: '',
            text: '## Vacuum Health',
            layout: { x: 0, y: 14, w: 12, h: 1 },
          },
          {
            id: 'w-dead-rows',
            type: 'metric',
            title: 'Total Dead Rows',
            query: 'SELECT COALESCE(sum(n_dead_tup), 0) FROM pg_stat_user_tables',
            layout: { x: 0, y: 15, w: 4, h: 3 },
          },
          {
            id: 'w-bloat',
            type: 'metric',
            title: 'Tables w/ Bloat',
            query:
              "SELECT count(*) FROM pg_stat_user_tables WHERE n_dead_tup > 0 AND n_dead_tup::float / nullif(n_live_tup + n_dead_tup, 0) > 0.1",
            layout: { x: 4, y: 15, w: 4, h: 3 },
          },
          {
            id: 'w-xid-risk',
            type: 'metric',
            title: 'XID Freeze Risk',
            query:
              "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND age(c.relfrozenxid) > 150000000",
            layout: { x: 8, y: 15, w: 4, h: 3 },
          },
          {
            id: 'w-vacuum-table',
            type: 'table',
            title: 'Vacuum Health',
            pageSize: 20,
            query:
              "SELECT schemaname, relname, n_dead_tup AS dead_rows, round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS dead_pct, COALESCE(to_char(GREATEST(last_vacuum, last_autovacuum), 'YYYY-MM-DD HH24:MI'), 'never') AS last_vacuum FROM pg_stat_user_tables ORDER BY n_dead_tup DESC",
            rowActions: [
              {
                workflowId: '{{workflow:vacuum-table}}',
                workflowName: 'Vacuum Table',
                label: 'Vacuum',
                variant: 'ghost',
                icon: 'refresh',
                condition: { column: 'dead_rows', operator: 'eq', value: '0', effect: 'disable' },
              },
            ],
            layout: { x: 0, y: 18, w: 12, h: 8 },
          },

          {
            id: 'w-index-head',
            type: 'text',
            title: '',
            text: '## Index Health — Unused Indexes',
            layout: { x: 0, y: 26, w: 12, h: 1 },
          },
          {
            id: 'w-unused-indexes',
            type: 'table',
            title: 'Unused Indexes',
            pageSize: 20,
            query:
              'SELECT indexrelname AS index, relname AS table, pg_size_pretty(pg_relation_size(indexrelid)) AS size, idx_scan AS scans FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY pg_relation_size(indexrelid) DESC',
            layout: { x: 0, y: 27, w: 12, h: 7 },
          },
        ],
      },
    },
  ],
}
