// Public API for the Redis feature (keyspace browser + command console).
//
// NOTE: RedisConsole/RedisEditor are intentionally NOT re-exported here. They
// pull in CodeMirror (heavy), so consumers lazy-import the console directly from
// `@/features/redis/components/RedisConsole` — same pattern as WorkflowEditor
// and DashboardView. Re-exporting them would statically bind CodeMirror to every
// eager importer of this barrel (e.g. WorkspacePage, which also needs the key
// tree), collapsing it back into the main bundle and defeating the code-split.
export { default as RedisKeyTree } from '@/features/redis/components/RedisKeyTree'
export { default as RedisKeyView } from '@/features/redis/components/RedisKeyView'

export { scanKeys, getOverview, readKey, deleteKeys, setKeyTtl } from '@/features/redis/lib/api'
export type { RedisKeyMeta, RedisKeyType, RedisKeyValue, RedisScanPage } from '@/features/redis/lib/api'
export { REDIS_COMMANDS, REDIS_COMMAND_NAMES, findCommand, commandAtCursor } from '@/features/redis/lib/commands'
export type { RedisCommandSpec } from '@/features/redis/lib/commands'
export { buildKeyTree, formatTtl, TYPE_COLOR, TYPE_LABEL } from '@/features/redis/lib/tree'
export type { RedisTreeNode } from '@/features/redis/lib/tree'
