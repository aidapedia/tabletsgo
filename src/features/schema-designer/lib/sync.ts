import { getDiagram, listTables } from '@/shared/api/database'

/**
 * Reading a database's schema into a design — what "Sync schema" does.
 *
 * The whole schema in one request is one wait with nothing to say about it, and
 * a large database makes that wait long. So the read is walked in slices: the
 * table list first (which is what makes a total knowable), then the diagram for
 * a few tables at a time, each slice a complete answer for the tables it names —
 * columns, indexes and foreign keys. That is the only reason for the slicing:
 * so the caller can say *where it is*, table by table, instead of spinning.
 *
 * Strict throughout, and deliberately so: the result is *stored* over the
 * design's own schema, and a failure that degraded to an empty answer would
 * quietly erase the diagram. A database with no tables still syncs to nothing,
 * which is a different thing and is correct.
 */

/** How many tables one request asks for. Enough to keep the round trips down, small enough that the bar actually moves. */
const SLICE = 8

export type SyncProgress = {
  /** Tables read so far, and how many there are in all. */
  done: number
  total: number
  /** The tables in flight right now — what the label names. */
  reading: string[]
  /** Indexes read so far, so the strip says what a sync brings in besides tables. */
  indexes: number
}

export type SyncedSchema = {
  tables: any[]
  foreignKeys: any[]
  /** Indexes across every table read — for the "synced N tables, M indexes" line. */
  indexCount: number
}

const fkKey = (fk: any) => fk?.constraint || `${fk?.table}.${fk?.column}->${fk?.refTable}.${fk?.refColumn}`

/**
 * Read `conn`'s whole schema, reporting progress as each slice lands.
 *
 * Throws if the database can't be read. A table dropped between the list and
 * its slice simply doesn't come back — the driver answers for the tables that
 * are still there, so a schema changing underneath a sync narrows the result
 * rather than failing it.
 */
export async function readSchema(
  conn: any,
  { onProgress }: { onProgress?: (p: SyncProgress) => void } = {}
): Promise<SyncedSchema> {
  const names: string[] = (await listTables(conn, { strict: true })) || []
  const total = names.length
  onProgress?.({ done: 0, total, reading: [], indexes: 0 })
  if (!total) return { tables: [], foreignKeys: [], indexCount: 0 }

  const tables: any[] = []
  const foreignKeys: any[] = []
  const seenFk = new Set<string>()
  let done = 0
  let indexes = 0

  for (let i = 0; i < names.length; i += SLICE) {
    const slice = names.slice(i, i + SLICE)
    onProgress?.({ done, total, reading: slice, indexes })
    const part: any = await getDiagram(conn, { strict: true, tables: slice })
    tables.push(...(part?.tables || []))
    // A foreign key belongs to the table that declares it, so slices can't
    // duplicate one — except on an engine that answers schema-wide anyway, which
    // is what the key guards against.
    for (const fk of part?.foreignKeys || []) {
      const key = fkKey(fk)
      if (seenFk.has(key)) continue
      seenFk.add(key)
      foreignKeys.push(fk)
    }
    done += slice.length
    indexes += (part?.tables || []).reduce((n: number, t: any) => n + (t.indexes?.length || 0), 0)
    onProgress?.({ done, total, reading: [], indexes })
  }

  return { tables, foreignKeys, indexCount: indexes }
}
