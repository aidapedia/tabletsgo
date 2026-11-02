/**
 * Confluent Schema Registry: browsing and managing subjects, and the wire
 * format — reading a schema-framed message as JSON, and writing JSON as one.
 *
 * The wire format is a magic byte 0, the schema id (int32, big-endian), then
 * the payload: Avro binary; Protobuf preceded by the message indexes (which
 * message of the .proto file, as a zig-zag varint array — a single 0 byte for
 * the first); or JSON text for JSON Schema.
 *
 * A schema id never changes what it points at, so compiled schemas are cached
 * per registry URL for the life of the process.
 */

import avro from 'avsc'
import protobuf from 'protobufjs'
import { restRequest, serviceUrl } from './kafka-rest.js'

const enc = encodeURIComponent
const call = (conn, path, options = {}) => restRequest(conn, 'schemaRegistry', { path, ...options, headers: { accept: 'application/vnd.schemaregistry.v1+json, application/json', ...options.headers } })

export const hasRegistry = (conn) => Boolean(serviceUrl(conn, 'schemaRegistry'))

export const COMPATIBILITY = ['BACKWARD', 'BACKWARD_TRANSITIVE', 'FORWARD', 'FORWARD_TRANSITIVE', 'FULL', 'FULL_TRANSITIVE', 'NONE']
const TYPES = new Set(['AVRO', 'PROTOBUF', 'JSON'])

// ---- Subjects ------------------------------------------------------------------------

async function mapLimited(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

// A subject's compatibility, or null when it inherits the global one.
async function subjectCompatibility(conn, subject) {
  try {
    const r = await call(conn, `/config/${enc(subject)}`)
    return r?.compatibilityLevel || r?.compatibility || null
  } catch (error) {
    if (error.httpStatus === 404) return null
    throw error
  }
}

/** Every subject with its latest version, plus the registry-wide compatibility. */
export async function listSchemas(conn) {
  const [subjects, global] = await Promise.all([call(conn, '/subjects'), call(conn, '/config')])
  const rows = await mapLimited([...subjects].sort(), 8, async (subject) => {
    try {
      const v = await call(conn, `/subjects/${enc(subject)}/versions/latest`)
      return { subject, version: v.version, id: v.id, type: v.schemaType || 'AVRO' }
    } catch (error) {
      return { subject, version: null, id: null, type: null, error: error.message }
    }
  })
  return { compatibility: global?.compatibilityLevel || global?.compatibility || 'BACKWARD', subjects: rows }
}

/** One subject: every version's schema, and its compatibility (own or inherited). */
export async function describeSchema(conn, subject) {
  const [versions, own, global] = await Promise.all([
    call(conn, `/subjects/${enc(subject)}/versions`),
    subjectCompatibility(conn, subject),
    call(conn, '/config'),
  ])
  const list = await mapLimited(versions, 6, (v) => call(conn, `/subjects/${enc(subject)}/versions/${v}`))
  return {
    subject,
    compatibility: own || global?.compatibilityLevel || 'BACKWARD',
    compatibilityInherited: !own,
    registryCompatibility: global?.compatibilityLevel || 'BACKWARD',
    versions: list
      .map((v) => ({ version: v.version, id: v.id, type: v.schemaType || 'AVRO', schema: v.schema, references: v.references || [] }))
      .sort((a, b) => b.version - a.version),
  }
}

function schemaBody({ schema, type = 'AVRO', references }) {
  const schemaType = String(type).toUpperCase()
  if (!TYPES.has(schemaType)) throw Object.assign(new Error('type must be AVRO, PROTOBUF or JSON.'), { status: 400 })
  if (!String(schema || '').trim()) throw Object.assign(new Error('A schema is required.'), { status: 400 })
  // Compiling first gives a local, precise error instead of the registry's 422 —
  // only possible without references, which the registry resolves itself.
  if (!references?.length) compile(schemaType, schema, [])
  return { schema, ...(schemaType === 'AVRO' ? {} : { schemaType }), ...(references?.length ? { references } : {}) }
}

/**
 * Register a schema under a subject (a new subject, or its next version). With
 * `validateOnly` it is only tested against the subject's compatibility rule.
 * Registering an identical schema returns the existing id — the registry's rule.
 */
export async function registerSchema(conn, subject, spec) {
  const body = schemaBody(spec)
  if (spec.validateOnly) {
    try {
      const r = await call(conn, `/compatibility/subjects/${enc(subject)}/versions/latest?verbose=true`, { method: 'POST', body })
      return { compatible: Boolean(r?.is_compatible), messages: r?.messages || [] }
    } catch (error) {
      // No versions yet: anything is compatible with nothing.
      if (error.httpStatus === 404) return { compatible: true, messages: [], firstVersion: true }
      throw error
    }
  }
  try {
    const { id } = await call(conn, `/subjects/${enc(subject)}/versions`, { method: 'POST', body })
    // The version this schema holds — not "latest": re-registering an older,
    // identical schema returns its existing id and version.
    const v = await call(conn, `/subjects/${enc(subject)}`, { method: 'POST', body })
    return { id, version: v.version }
  } catch (error) {
    if (error.httpStatus === 409) throw Object.assign(new Error(`The schema is incompatible with "${subject}" under its compatibility rule: ${error.message}`), { status: 409 })
    throw error
  }
}

/**
 * Delete one version or the whole subject. Soft by default (the registry keeps
 * it, and ids still resolve, so old messages stay readable); `permanent` does
 * the soft delete first, as the registry requires, then the hard one.
 */
export async function deleteSchema(conn, subject, { version, permanent = false } = {}) {
  const path = version != null && version !== '' ? `/subjects/${enc(subject)}/versions/${enc(String(version))}` : `/subjects/${enc(subject)}`
  try {
    await call(conn, path, { method: 'DELETE' })
  } catch (error) {
    // Already soft-deleted: fine when the hard delete is what's wanted.
    if (!(permanent && (error.code === 40404 || error.code === 40406))) throw error
  }
  if (permanent) await call(conn, `${path}?permanent=true`, { method: 'DELETE' })
  return { ok: true }
}

/** Set the compatibility rule of one subject, or of the registry (no subject); null clears a subject's own. */
export async function setSchemaCompatibility(conn, subject, level) {
  if (level === null && subject) {
    await call(conn, `/config/${enc(subject)}`, { method: 'DELETE' }).catch((error) => {
      if (error.httpStatus !== 404) throw error
    })
    return { ok: true, compatibility: null }
  }
  const value = String(level || '').toUpperCase()
  if (!COMPATIBILITY.includes(value)) throw Object.assign(new Error(`compatibility must be one of ${COMPATIBILITY.join(', ')}.`), { status: 400 })
  await call(conn, subject ? `/config/${enc(subject)}` : '/config', { method: 'PUT', body: { compatibility: value } })
  return { ok: true, compatibility: value }
}

// ---- Compiling schemas -------------------------------------------------------------------

/**
 * A schema's text (+ its compiled references) → a codec:
 *   { type, decode(payload) → JSON-able value, encode(value, message?) → payload Buffer }
 * where `payload` is what follows the magic byte and id.
 */
function compile(type, text, refs) {
  if (type === 'AVRO') {
    const registry = {}
    for (const r of refs) avro.Type.forSchema(JSON.parse(r.schema), { registry })
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw Object.assign(new Error(`The Avro schema is not valid JSON: ${error.message}`), { status: 400 })
    }
    let t
    try {
      t = avro.Type.forSchema(parsed, { registry })
    } catch (error) {
      throw Object.assign(new Error(`Invalid Avro schema: ${error.message}`), { status: 400 })
    }
    return {
      type,
      decode: (payload) => t.fromBuffer(payload),
      encode: (value) => {
        // Plain JSON, with bytes/fixed as Avro writes them in JSON (one char per byte).
        const coerced = coerceAvro(t, value)
        if (t.isValid(coerced)) return t.toBuffer(coerced)
        // Avro's own JSON encoding (unions wrapped as {"string": "x"}) is accepted too.
        try {
          return t.toBuffer(t.fromString(JSON.stringify(value)))
        } catch {
          const paths = []
          t.isValid(value, { errorHook: (path, v, at) => paths.push(`${path.join('.') || '(root)'} = ${JSON.stringify(v)} is not ${at.typeName || at.type || 'valid'}`) })
          throw Object.assign(new Error(`The value doesn't match the Avro schema: ${paths.slice(0, 3).join('; ')}`), { status: 400 })
        }
      },
    }
  }

  if (type === 'PROTOBUF') {
    const root = new protobuf.Root()
    const addCommon = (imports = []) => {
      for (const file of imports) {
        const common = file.startsWith('google/protobuf/') && protobuf.common.get(file)
        if (common) root.addJSON(common.nested)
      }
    }
    const parseInto = (source) => {
      const parsed = protobuf.parse(source, root, { keepCase: true })
      addCommon(parsed.imports)
      return parsed
    }
    for (const r of refs) parseInto(r.schema)
    const before = new Set(allTypes(root))
    let parsed
    try {
      parsed = parseInto(text)
      root.resolveAll()
    } catch (error) {
      throw Object.assign(new Error(`Invalid Protobuf schema: ${error.message}`), { status: 400 })
    }
    const scope = parsed.package ? root.lookup(parsed.package) : root
    // The file's own top-level messages, in declaration order — what index 0, 1… mean.
    const top = (scope?.nestedArray || []).filter((n) => n instanceof protobuf.Type && !before.has(n))
    if (!top.length) throw Object.assign(new Error('The Protobuf schema declares no message.'), { status: 400 })
    const byIndexes = (indexes) => {
      let t = top[indexes[0]]
      for (const i of indexes.slice(1)) t = t?.nestedArray.filter((n) => n instanceof protobuf.Type)[i]
      if (!t) throw new Error(`No message at index [${indexes.join(', ')}] in this schema.`)
      return t
    }
    const indexesOf = (name) => {
      const target = name ? root.lookupType(name) : top[0]
      const path = []
      for (let t = target; t && t !== scope && t.parent; t = t.parent) {
        const siblings = (t.parent === scope ? top : t.parent.nestedArray.filter((n) => n instanceof protobuf.Type))
        path.unshift(siblings.indexOf(t))
      }
      if (path.some((i) => i < 0)) throw Object.assign(new Error(`Message "${name}" is not declared in this schema.`), { status: 400 })
      return path
    }
    return {
      type,
      messages: top.map((t) => t.fullName.replace(/^\./, '')),
      decode: (payload) => {
        const { indexes, offset } = readIndexes(payload)
        const t = byIndexes(indexes)
        return t.toObject(t.decode(payload.subarray(offset)), { longs: String, enums: String, bytes: String, defaults: true })
      },
      encode: (value, message) => {
        const indexes = indexesOf(message)
        const t = byIndexes(indexes)
        let msg
        try {
          msg = t.fromObject(value)
        } catch (error) {
          throw Object.assign(new Error(`The value doesn't match ${t.name}: ${error.message}`), { status: 400 })
        }
        return Buffer.concat([writeIndexes(indexes), Buffer.from(t.encode(msg).finish())])
      },
    }
  }

  // JSON Schema: the payload is the JSON itself. Validation is the producer's
  // job and isn't repeated here — the schema only frames the message.
  try {
    JSON.parse(text)
  } catch (error) {
    throw Object.assign(new Error(`The JSON schema is not valid JSON: ${error.message}`), { status: 400 })
  }
  return {
    type,
    decode: (payload) => JSON.parse(payload.toString('utf8')),
    encode: (value) => Buffer.from(JSON.stringify(value)),
  }
}

// JSON → the values avsc writes: bytes/fixed from their one-char-per-byte
// strings, found by walking the schema alongside the value. An unwrapped union
// takes the first branch the value fits.
function coerceAvro(t, v) {
  if (v == null) return v
  const name = t.typeName
  if (name === 'bytes' || name === 'fixed') return typeof v === 'string' ? Buffer.from(v, 'latin1') : v
  if (name === 'record' || name === 'error') {
    if (typeof v !== 'object') return v
    const out = { ...v }
    for (const f of t.fields) if (f.name in out) out[f.name] = coerceAvro(f.type, out[f.name])
    return out
  }
  if (name === 'array') return Array.isArray(v) ? v.map((x) => coerceAvro(t.itemsType, x)) : v
  if (name === 'map') return typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, coerceAvro(t.valuesType, x)])) : v
  if (name === 'union:unwrapped') {
    for (const branch of t.types) {
      const c = coerceAvro(branch, v)
      if (branch.isValid(c)) return c
    }
    return v
  }
  if (name.startsWith('logical')) return coerceAvro(t.underlyingType, v)
  return v
}

function allTypes(ns, out = []) {
  for (const n of ns.nestedArray || []) {
    out.push(n)
    allTypes(n, out)
  }
  return out
}

// Zig-zag varints, as Confluent's Protobuf serializer writes the message indexes.
function readVarint(buf, at) {
  let value = 0
  let shift = 0
  let i = at
  for (;;) {
    if (i >= buf.length) throw new Error('Truncated message indexes.')
    const b = buf[i++]
    value |= (b & 0x7f) << shift
    if (!(b & 0x80)) break
    shift += 7
  }
  return { value: (value >>> 1) ^ -(value & 1), next: i }
}

function readIndexes(buf) {
  const count = readVarint(buf, 0)
  if (count.value === 0) return { indexes: [0], offset: count.next }
  const indexes = []
  let at = count.next
  for (let i = 0; i < count.value; i++) {
    const v = readVarint(buf, at)
    indexes.push(v.value)
    at = v.next
  }
  return { indexes, offset: at }
}

function writeVarint(n) {
  let v = (n << 1) ^ (n >> 31)
  const out = []
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  out.push(v)
  return out
}

function writeIndexes(indexes) {
  if (indexes.length === 1 && indexes[0] === 0) return Buffer.from([0])
  return Buffer.from([...writeVarint(indexes.length), ...indexes.flatMap(writeVarint)])
}

// ---- Resolving schemas by id or subject ---------------------------------------------------

const cache = new Map() // `${url}|id:N` → Promise<codec>

async function referencesOf(conn, refs = [], seen = new Set()) {
  const out = []
  for (const r of refs) {
    const key = `${r.subject}@${r.version}`
    if (seen.has(key)) continue
    seen.add(key)
    const v = await call(conn, `/subjects/${enc(r.subject)}/versions/${enc(String(r.version))}`)
    out.push(...(await referencesOf(conn, v.references, seen)), { name: r.name, schema: v.schema })
  }
  return out
}

function codecById(conn, id) {
  const key = `${serviceUrl(conn, 'schemaRegistry')}|id:${id}`
  if (!cache.has(key)) {
    const p = (async () => {
      const s = await call(conn, `/schemas/ids/${id}`)
      return compile(s.schemaType || 'AVRO', s.schema, await referencesOf(conn, s.references))
    })()
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return cache.get(key)
}

const isFramed = (buf) => buf && buf.length > 5 && buf[0] === 0

// Avro bytes/fixed read the way Avro writes them in JSON — one character per
// byte — so a decoded message can be produced again as it is.
const toJson = (value) =>
  JSON.stringify(value, (k, v) => (v && v.type === 'Buffer' && Array.isArray(v.data) ? Buffer.from(v.data).toString('latin1') : typeof v === 'bigint' ? String(v) : v))

/**
 * A decoder for one read: `decode(buf)` → the message as JSON text when it is
 * schema-framed and the registry can explain it, otherwise null (the caller
 * falls back to its own decoding). A schema the registry can't produce is
 * asked for once per read, not once per message.
 */
export function registryDecoder(conn) {
  if (!hasRegistry(conn)) return null
  const failed = new Map()
  return async (buf) => {
    if (!isFramed(buf)) return null
    const id = buf.readInt32BE(1)
    if (failed.has(id)) return null
    try {
      const codec = await codecById(conn, id)
      return toJson(codec.decode(buf.subarray(5)))
    } catch (error) {
      failed.set(id, error)
      return null
    }
  }
}

/**
 * JSON text → a schema-framed message, with the subject's schema at `version`
 * (default latest). `message` picks a Protobuf message other than the first.
 */
export async function serializeWithSchema(conn, { subject, version = 'latest', message } = {}, text) {
  if (!subject) throw Object.assign(new Error('Name the subject whose schema to write with.'), { status: 400 })
  let value
  try {
    value = typeof text === 'string' ? JSON.parse(text) : text
  } catch (error) {
    throw Object.assign(new Error(`A schema-encoded message is written from JSON: ${error.message}`), { status: 400 })
  }
  const v = await call(conn, `/subjects/${enc(subject)}/versions/${enc(String(version))}`)
  const codec = await codecById(conn, v.id)
  const header = Buffer.alloc(5)
  header.writeInt32BE(v.id, 1)
  return Buffer.concat([header, codec.encode(value, message)])
}

