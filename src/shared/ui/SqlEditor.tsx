import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql as sqlExtension, SQLite, PostgreSQL } from '@codemirror/lang-sql'
import { EditorView, tooltips } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Prec } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'

// Editor chrome themed to match the app (dark). Exported so the Redis console's
// editor renders as the same surface with a different grammar.
export const editorTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--color-bg)', color: 'var(--color-ink)', fontSize: '12px' },
    '.cm-scroller': { fontFamily: '"SF Mono", Menlo, Consolas, monospace',overflow: 'auto' },
    '.cm-content': { padding: '14px 0', caretColor: 'var(--color-green)' },
    '.cm-placeholder': { color: 'var(--color-ink-faint)' },
    '.cm-gutters': { backgroundColor: 'var(--color-bg)', color: 'var(--color-ink-faint)', border: 'none' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 16px' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.025)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-ink-dim)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-green)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(111,207,106,0.22)',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'rgba(111,207,106,0.15)',
      outline: '1px solid rgba(111,207,106,0.4)',
    },

    // Autocomplete popup
    '.cm-tooltip': {
      backgroundColor: 'var(--color-elevated)',
      border: '1px solid var(--color-edge-strong)',
      borderRadius: '10px',
      overflow: 'hidden',
      zIndex: '200', // above the node config slide-over (z-50)
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: '"SF Mono", Menlo, Consolas, monospace',
      maxHeight: '15em',
    },
    '.cm-tooltip-autocomplete > ul > li': {
      display: 'flex',
      alignItems: 'center',
      padding: '5px 12px',
      fontSize: '11px',
      color: 'var(--color-ink-dim)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'rgba(111,207,106,0.16)',
      color: 'var(--color-ink)',
    },
    '.cm-completionLabel': { flex: '1' },
    '.cm-completionMatchedText': { color: 'var(--color-green)', textDecoration: 'none', fontWeight: '700' },
    '.cm-completionDetail': { color: 'var(--color-ink-faint)', fontStyle: 'normal', marginLeft: '1.2rem', fontSize: '10px' },

    // Type icons — themed glyphs keyed to what each completion represents.
    '.cm-completionIcon': {
      width: '1.4em',
      paddingRight: '0.5em',
      textAlign: 'center',
      fontSize: '100%',
      opacity: '1',
    },
    '.cm-completionIcon-keyword::after': { content: '"◆"', color: '#7aa2f7' }, // SQL command
    '.cm-completionIcon-class::after': { content: '"▦"', color: '#82aaff' }, // table (our source)
    '.cm-completionIcon-property::after': { content: '"◫"', color: 'var(--color-green)' }, // column
    '.cm-completionIcon-variable::after': { content: '"◫"', color: 'var(--color-green)' }, // column
    '.cm-completionIcon-type::after': { content: '"◇"', color: '#5fb3b3' }, // data type
    '.cm-completionIcon-function::after': { content: '"ƒ"', color: '#c792ea' }, // function
    '.cm-completionIcon-constant::after': { content: '"α"', color: 'var(--color-amber)' }, // constant
    '.cm-completionIcon-text::after': { content: '"◦"', color: 'var(--color-ink-dim)' },
  },
  { dark: true }
)

// Token colors — shared by every code editor in the app (SQL and Redis).
export const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#7aa2f7', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: '#8fe08a' },
  { tag: [t.number, t.bool, t.null], color: '#d6a73a' },
  { tag: [t.operator, t.punctuation, t.separator], color: '#9aa0aa' },
  { tag: t.function(t.variableName), color: '#6fcf6a' },
  { tag: t.typeName, color: '#82aaff' },
  { tag: t.comment, color: '#6b6b72', fontStyle: 'italic' },
  { tag: t.variableName, color: '#f4f4f5' },
])

// Completion schema shape lang-sql understands: { tableName: [columnName, ...] }.
// Passing it in gives table, column *and* keyword suggestions.
export type SqlSchema = Record<string, string[]>

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Keywords that can't be a table alias — so `FROM events WHERE` doesn't read
// "where" as an alias of events.
const NOT_ALIAS = new Set([
  'where', 'on', 'using', 'group', 'order', 'limit', 'offset', 'having', 'join',
  'inner', 'left', 'right', 'outer', 'cross', 'full', 'natural', 'set', 'values',
  'select', 'and', 'or', 'as', 'union', 'when', 'then', 'else', 'end',
])
// After these, the cursor is in a table position → suggest tables, not columns.
const TABLE_POSITION = new Set(['from', 'join', 'into', 'update', 'table'])

// Map `FROM users u` / `JOIN orders AS o` → { u: 'users', o: 'orders' } so a
// qualified `u.` can resolve to the right table's columns.
function parseAliases(text: string) {
  const aliases: Record<string, string> = {}
  const re = /\b(?:from|join|update|into)\s+"?(\w+)"?(?:\s+(?:as\s+)?"?(\w+)"?)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m[2] && !NOT_ALIAS.has(m[2].toLowerCase())) aliases[m[2]] = m[1]
  }
  return aliases
}

// Owns all schema-driven completion (tables + columns, bare and qualified) so we
// get correct icons and context: lang-sql is left to handle keywords/types/
// functions only. Columns of referenced tables are surfaced as bare identifiers
// (lang-sql only offers them qualified), and `alias.`/`table.` resolves columns.
function schemaCompletionSource(schema: SqlSchema) {
  const tables = Object.keys(schema)
  return (context: any) => {
    const text = context.state.doc.toString()

    // Qualified: <table|alias>.<partial>
    const dotted = context.matchBefore(/\w+\.\w*/)
    if (dotted) {
      const m = /(\w+)\.(\w*)$/.exec(dotted.text)
      if (!m) return null
      const aliases = parseAliases(text)
      const table = schema[m[1]] ? m[1] : aliases[m[1]]
      if (!table || !schema[table]) return null
      return {
        from: dotted.from + m[1].length + 1,
        options: schema[table].map((c) => ({ label: c, type: 'property', detail: table })),
        validFor: /^\w*$/,
      }
    }

    const word = context.matchBefore(/\w+/)
    if (!word || (word.from === word.to && !context.explicit)) return null

    // Is the token right before us a keyword that expects a table name?
    const prev = text.slice(0, word.from).match(/(\w+)\s+$/)
    const tablePosition = prev ? TABLE_POSITION.has(prev[1].toLowerCase()) : false

    const options: any[] = []
    // Tables (always relevant; the only thing offered in a table position).
    for (const t of tables) options.push({ label: t, type: 'class', detail: 'table', boost: 1 })

    if (!tablePosition) {
      // Columns of the tables the query references (else every table's columns).
      const referenced = tables.filter((t) => new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i').test(text))
      const active = referenced.length ? referenced : tables
      const seen = new Set<string>()
      for (const t of active) {
        for (const col of schema[t] || []) {
          if (seen.has(col.toLowerCase())) continue
          seen.add(col.toLowerCase())
          options.push({ label: col, type: 'property', detail: t, boost: 2 })
        }
      }
    }
    return { from: word.from, options, validFor: /^\w*$/ }
  }
}

type SqlEditorProps = {
  value: string
  onChange: (value: string) => void
  /** Connection type — picks the SQL dialect for parsing/completion. */
  dialect?: string
  /** Table → columns map used to power autocomplete. */
  schema?: SqlSchema
  editable?: boolean
  placeholder?: string
  minHeight?: string
  maxHeight?: string
}

// Themed, schema-aware SQL code editor shared by the query tab and the workflow
// "Run a query" node so both get identical highlighting and autocomplete.
export default function SqlEditor({
  value,
  onChange,
  dialect,
  schema = {},
  editable = true,
  placeholder = 'Write SQL…',
  minHeight = '',
  maxHeight = '460px',
}: SqlEditorProps) {
  const extensions = useMemo(() => {
    // Note: schema is intentionally NOT handed to lang-sql — our own source owns
    // tables/columns (correct icons + context), lang-sql owns keywords/types/fns.
    const lang = sqlExtension({
      dialect: dialect === 'postgresql' ? PostgreSQL : SQLite,
      upperCaseKeywords: true,
    })
    const exts = [
      lang,
      lang.language.data.of({ autocomplete: schemaCompletionSource(schema) }),
      Prec.highest(syntaxHighlighting(highlightStyle)),
      EditorView.lineWrapping,
      // Size the editor via the scroller, not the root `&`. The tooltip parent
      // below copies the editor's root theme class onto a <body>-level host; a
      // min-/max-height on `&` would leak there and render as a stray blank band
      // in normal flow. `.cm-scroller` is editor-only, so it can't leak.
      EditorView.theme({ '.cm-scroller': { minHeight, maxHeight, overflowY: 'auto', overflowX: 'hidden' } }),
      // Render the autocomplete popup on document.body so it isn't clipped or
      // mis-positioned by scroll/overflow/transform ancestors (e.g. the node
      // config slide-over). CodeMirror copies the theme onto the body container,
      // so styling is preserved.
      tooltips({ position: 'fixed', parent: document.body }),
    ]
    return exts
  }, [schema, dialect, minHeight, maxHeight])

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={editorTheme}
      extensions={extensions}
      editable={editable}
      placeholder={placeholder}
      basicSetup={{
        foldGutter: false,
        highlightActiveLine: true,
        autocompletion: true,
        highlightSelectionMatches: false,
        searchKeymap: false,
      }}
    />
  )
}
