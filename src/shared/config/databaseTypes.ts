// Database type labels are shared by connection forms, schemas and templates.
// Availability is a UI hint; the server's driver registry decides capabilities.
export const DB_CATALOG = [
  { id: 'postgresql', label: 'PostgreSQL', desc: 'Open-source relational database', available: true },
  { id: 'sqlite', label: 'SQLite', desc: 'Embedded file-based database', available: true },
  { id: 'mysql', label: 'MySQL', desc: 'Popular relational database', available: false },
  { id: 'mariadb', label: 'MariaDB', desc: 'MySQL-compatible database', available: false },
  { id: 'mongodb', label: 'MongoDB', desc: 'Document NoSQL database', available: false },
  { id: 'redis', label: 'Redis', desc: 'In-memory key-value store', available: true },
]

export const TYPE_LABEL: Record<string, string> = Object.fromEntries(DB_CATALOG.map((db) => [db.id, db.label]))
