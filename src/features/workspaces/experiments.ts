// Registry of beta experiments toggleable per workspace (Workspace → Beta tab).
// Add a new entry here + gate the relevant UI on `current?.experiments?.[key]`.
export const EXPERIMENTS = [
  {
    key: 's3Backup',
    label: 'S3 Storage & Backup/Restore',
    description: 'Object storage destinations, scheduled connection backups, and restore. Adds the S3 Storage nav item and the Backup tab on each connection.',
  },
] as const

export type ExperimentKey = (typeof EXPERIMENTS)[number]['key']
