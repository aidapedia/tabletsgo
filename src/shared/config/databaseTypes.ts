// Database type labels are shared by connection forms, schemas and templates.
// Availability is a UI hint; the server's driver registry decides capabilities.
//
// `console` is the shape of the per-connection console the engine gets — the
// one thing the frontend branches on, rather than naming engines one by one:
//   sql       tables browser, SQL editor, schema designer, export/import
//   keyspace  key tree + command console (Redis)
//   stream    topics/groups sidebar + command console (Kafka)
export type ConsoleKind = 'sql' | 'keyspace' | 'stream'

export const DB_CATALOG: { id: string; label: string; desc: string; available: boolean; console: ConsoleKind }[] = [
  { id: 'postgresql', label: 'PostgreSQL', desc: 'Open-source relational database', available: true, console: 'sql' },
  { id: 'sqlite', label: 'SQLite', desc: 'Embedded file-based database', available: true, console: 'sql' },
  { id: 'mysql', label: 'MySQL', desc: 'Popular relational database', available: true, console: 'sql' },
  { id: 'mariadb', label: 'MariaDB', desc: 'MySQL-compatible database', available: false, console: 'sql' },
  { id: 'mongodb', label: 'MongoDB', desc: 'Document NoSQL database', available: false, console: 'sql' },
  { id: 'redis', label: 'Redis', desc: 'In-memory key-value store', available: true, console: 'keyspace' },
  { id: 'kafka', label: 'Kafka', desc: 'Event streaming: topics, messages, consumer groups', available: true, console: 'stream' },
]

export const TYPE_LABEL: Record<string, string> = Object.fromEntries(DB_CATALOG.map((db) => [db.id, db.label]))

/** The engines whose whole database can be dumped — the ones a backup schedule applies to. */
export const supportsBackup = (type?: string) => type === 'sqlite' || type === 'postgresql' || type === 'mysql'

/** The console shape for a connection type — `sql` for anything unknown. */
export const consoleKindOf = (type?: string): ConsoleKind => DB_CATALOG.find((db) => db.id === type)?.console || 'sql'
