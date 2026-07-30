import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { EditorView, tooltips } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { editorTheme, highlightStyle } from '@/shared/ui/SqlEditor'
import { REDIS_COMMANDS, REDIS_COMMAND_NAMES } from '../lib/commands'

/**
 * Redis command editor — the console's input. Same chrome as the SQL editor
 * (theme and token colors are shared) with a Redis grammar instead: one command
 * per line, `#` comments, quoted arguments.
 *
 * Written as a StreamLanguage rather than a full Lezer grammar because the
 * syntax genuinely is line-oriented and trivial: the first token is a command,
 * the rest are arguments.
 */
const redisLanguage = StreamLanguage.define({
  name: 'redis',
  startState: () => ({ atLineStart: true }),
  token(stream, state) {
    if (stream.sol()) state.atLineStart = true
    if (stream.eatSpace()) return null

    // Whole-line comment, redis.conf style.
    if (state.atLineStart && stream.peek() === '#') {
      stream.skipToEnd()
      return 'comment'
    }

    // Quoted argument, with backslash escapes.
    const quote = stream.peek()
    if (quote === '"' || quote === "'") {
      stream.next()
      let escaped = false
      while (!stream.eol()) {
        const ch = stream.next()
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === quote) break
      }
      state.atLineStart = false
      return 'string'
    }

    const word = stream.match(/^\S+/)
    const text = Array.isArray(word) ? word[0] : String(word)
    if (state.atLineStart) {
      state.atLineStart = false
      // Unknown commands stay unhighlighted — a visible hint that it's a typo
      // (or a module command we don't know), without blocking the run.
      return REDIS_COMMAND_NAMES.has(text.toUpperCase()) ? 'keyword' : 'variableName'
    }
    if (/^[-+]?\d+(\.\d+)?$/.test(text)) return 'number'
    // Sub-commands / option flags (GET, MATCH, WITHSCORES, EX, …) read as
    // keywords too; they're the uppercase words that aren't the first token.
    if (/^[A-Z][A-Z0-9_-]*$/.test(text)) return 'typeName'
    return 'variableName'
  },
})

// Command-name completion, offered only in the first token of a line — nothing
// else on the line is a command, and suggesting one there would be noise.
function commandCompletionSource(context: any) {
  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, context.pos - line.from)
  if (/\s/.test(before.trimStart())) return null // past the first token

  const word = context.matchBefore(/\S+/)
  if (!word && !context.explicit) return null
  return {
    from: word ? word.from : context.pos,
    options: REDIS_COMMANDS.map((c) => ({
      label: c.name,
      type: 'keyword',
      detail: c.args || c.group,
      // Space after the command so the next token starts cleanly.
      apply: `${c.name} `,
    })),
    validFor: /^\S*$/,
  }
}

export default function RedisEditor({
  value,
  onChange,
  editable = true,
  placeholder = 'Type a Redis command…',
  minHeight = '',
  maxHeight = '460px',
}: {
  value: string
  onChange: (value: string) => void
  editable?: boolean
  placeholder?: string
  minHeight?: string
  maxHeight?: string
}) {
  const extensions = useMemo(
    () => [
      redisLanguage,
      redisLanguage.data.of({ autocomplete: commandCompletionSource }),
      Prec.highest(syntaxHighlighting(highlightStyle)),
      EditorView.lineWrapping,
      EditorView.theme({ '.cm-scroller': { minHeight, maxHeight, overflowY: 'auto', overflowX: 'hidden' } }),
      tooltips({ position: 'fixed', parent: document.body }),
    ],
    [minHeight, maxHeight]
  )

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
