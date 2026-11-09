import type { ReactNode } from 'react'

export type CodeLanguage = 'json' | 'protobuf'

// One palette for every hand-rolled highlighter — the Kafka message inspector's,
// which matches the SQL editor's — so a JSON value, an Avro schema and a .proto
// all read the same without pulling CodeMirror into the view.
const CLASSES = {
  key: 'text-[#9ecbff]',
  string: 'text-primary-bright',
  number: 'text-warning',
  literal: 'text-[#c49bff]',
  type: 'text-[#9ecbff]',
  comment: 'text-faint',
  punct: 'text-foreground',
} as const
type Token = keyof typeof CLASSES

// A highlighter, not a parser: it matches as text is typed, even mid-edit or
// invalid, and anything unmatched is left as plain text.
const JSON_RE = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?)|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],:])/g

const PROTO_KEYWORDS =
  'syntax|edition|package|import|public|weak|option|message|enum|service|rpc|returns|stream|oneof|map|reserved|extend|extensions|to|max|optional|repeated|required|true|false'
const PROTO_TYPES = 'double|float|int32|int64|uint32|uint64|sint32|sint64|fixed32|fixed64|sfixed32|sfixed64|bool|string|bytes'
const PROTO_RE = new RegExp(
  [
    String.raw`(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))`,
    String.raw`("(?:\\.|[^\\"\n])*"?|'(?:\\.|[^\\'\n])*'?)`,
    String.raw`\b(${PROTO_KEYWORDS})\b`,
    String.raw`\b(${PROTO_TYPES}|google\.protobuf\.\w+)\b`,
    String.raw`(-?\b\d+(?:\.\d+)?\b)`,
    String.raw`([{}[\]();=<>,])`,
  ].join('|'),
  'g'
)

function tokenize(text: string, language: CodeLanguage): { text: string; token?: Token }[] {
  const re = language === 'protobuf' ? PROTO_RE : JSON_RE
  const parts: { text: string; token?: Token }[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) })
    let token: Token
    if (language === 'protobuf') {
      const [, comment, str, keyword, type, num] = m
      token = comment ? 'comment' : str ? 'string' : keyword ? 'literal' : type ? 'type' : num ? 'number' : 'punct'
    } else {
      const [, str, colon, literal, num] = m
      token = str ? (colon ? 'key' : 'string') : literal ? 'literal' : num ? 'number' : 'punct'
    }
    parts.push({ text: m[0], token })
    last = m.index! + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

/** `text` as coloured spans, for a `<pre>` or an editor's backdrop. */
export function highlight(text: string, language: CodeLanguage = 'json'): ReactNode[] {
  return tokenize(text, language).map((t, i) =>
    t.token ? (
      <span key={i} className={CLASSES[t.token]}>
        {t.text}
      </span>
    ) : (
      t.text
    )
  )
}
