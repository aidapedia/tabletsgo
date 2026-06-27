import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql as sqlExtension, SQLite, PostgreSQL } from '@codemirror/lang-sql'
import { EditorView, keymap } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Prec } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'
import { format } from 'sql-formatter'
import { getSchema, runQuery } from '../../db/sqlite.js'
import DataGrid from './DataGrid.jsx'
import Button from '../ui/Button.jsx'
import { SaveIcon, WandIcon } from '../icons.jsx'

// Editor chrome themed to match the app (dark).
const editorTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--color-bg)', color: 'var(--color-ink)', fontSize: '12px' },
    '.cm-scroller': { fontFamily: '"SF Mono", Menlo, Consolas, monospace' },
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
      boxShadow: '0 16px 40px -12px rgba(0,0,0,0.8)',
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

    // Type icons — themed glyphs instead of the default key/wrench
    '.cm-completionIcon': {
      width: '1.3em',
      paddingRight: '0.5em',
      textAlign: 'center',
      fontSize: '95%',
      opacity: '1',
    },
    '.cm-completionIcon-keyword::after': { content: '"✦"', color: '#7aa2f7' },
    '.cm-completionIcon-type::after': { content: '"▦"', color: '#82aaff' },
    '.cm-completionIcon-class::after': { content: '"▦"', color: '#82aaff' },
    '.cm-completionIcon-property::after': { content: '"▮"', color: 'var(--color-green)' },
    '.cm-completionIcon-variable::after': { content: '"▮"', color: 'var(--color-green)' },
    '.cm-completionIcon-function::after': { content: '"ƒ"', color: 'var(--color-green)' },
    '.cm-completionIcon-constant::after': { content: '"●"', color: 'var(--color-amber)' },
  },
  { dark: true }
)

// SQL token colors.
const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#7aa2f7', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: '#8fe08a' },
  { tag: [t.number, t.bool, t.null], color: '#d6a73a' },
  { tag: [t.operator, t.punctuation, t.separator], color: '#9aa0aa' },
  { tag: t.function(t.variableName), color: '#6fcf6a' },
  { tag: t.typeName, color: '#82aaff' },
  { tag: t.comment, color: '#6b6b72', fontStyle: 'italic' },
  { tag: t.variableName, color: '#f4f4f5' },
])

export default function QueryEditor({ conn, dialect, initialSql, onRan, onSave }) {
  const [sql, setSql] = useState(initialSql || 'SELECT * FROM events LIMIT 10;')
  const [schema, setSchema] = useState({})
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    getSchema(conn).then((s) => alive && setSchema(s))
    return () => {
      alive = false
    }
  }, [conn])

  const run = async () => {
    setError(null)
    setLoading(true)
    try {
      const queryResult = await runQuery(conn, sql)
      if (queryResult.error) {
        setError(queryResult.error)
        setResult(null)
      } else {
        setResult(queryResult)
        const rows = queryResult.type === 'rows' ? queryResult.rows.length : null
        onRan?.({ sql: sql.trim(), ts: Date.now(), rows })
      }
    } catch (e) {
      setResult(null)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const beautify = () => {
    try {
      setSql(
        format(sql, {
          language: conn.type === 'postgresql' ? 'postgresql' : 'sqlite',
          keywordCase: 'upper',
          tabWidth: 2,
        })
      )
    } catch {
      /* leave the SQL untouched if it can't be parsed */
    }
  }

  // Keep the keymap stable while always calling the latest run().
  const runRef = useRef(run)
  runRef.current = run

  const extensions = useMemo(
    () => [
      sqlExtension({
        dialect: conn.type === 'postgresql' ? PostgreSQL : SQLite,
        schema,
        upperCaseKeywords: true,
      }),
      Prec.highest(syntaxHighlighting(highlightStyle)),
      EditorView.lineWrapping,
      Prec.highest(
        keymap.of([
          { key: 'Mod-Enter', preventDefault: true, run: () => (runRef.current(), true) },
        ])
      ),
    ],
    [schema, conn.type]
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <Button variant="primary" size="sm" onClick={run} disabled={loading}>
          {loading ? '⏳ Running…' : '▶ Run Query'}
          <kbd className="rounded bg-black/20 px-1.5 py-px text-[10px] font-semibold">⌘↵</kbd>
        </Button>

        <div className="mx-0.5 h-5 w-px bg-edge" />

        <Button variant="subtle" size="sm" className="!px-2" onClick={beautify} title="Beautify SQL">
          <WandIcon width={15} height={15} />
        </Button>
        <Button
          variant="subtle"
          size="sm"
          className="!px-2"
          onClick={() => onSave?.(sql)}
          title="Save query"
          disabled={!sql.trim()}
        >
          <SaveIcon width={15} height={15} />
        </Button>

        <span className="ml-auto rounded-soft border border-edge bg-elevated px-3 py-1.5 text-[11px] font-semibold text-ink-dim">
          {dialect}
        </span>
      </div>

      <div className="border-b border-edge bg-bg">
        <CodeMirror
          value={sql}
          onChange={setSql}
          theme={editorTheme}
          extensions={extensions}
          editable={!loading}
          placeholder="Write SQL and press ⌘↵ to run…"
          minHeight="180px"
          maxHeight="460px"
          basicSetup={{
            foldGutter: false,
            highlightActiveLine: true,
            autocompletion: true,
            highlightSelectionMatches: false,
            searchKeymap: false,
          }}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {error && (
          <div className="mx-[18px] my-4 rounded-[9px] border border-red/25 bg-red/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">
            ❌ {error}
          </div>
        )}
        {!error && result?.type === 'rows' && (
          <>
            <div className="border-b border-edge px-[18px] py-2 text-xs text-ink-dim">{result.rows.length} row(s)</div>
            <DataGrid columns={result.columns} rows={result.rows} />
          </>
        )}
        {!error && result?.type === 'message' && (
          <div className="mx-[18px] my-4 rounded-[9px] border border-green-dim bg-green/10 px-3.5 py-3 text-[11px] text-green-bright">
            ✅ {result.message}
          </div>
        )}
        {!error && !result && (
          <div className="p-[30px] text-center text-ink-faint">Run a query to see results here.</div>
        )}
      </div>
    </div>
  )
}
