import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { EditorView, tooltips } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { editorTheme, highlightStyle } from '@/shared/ui/SqlEditor'
import { findKafkaCommand, KAFKA_COMMANDS, KAFKA_COMMAND_NAMES, KAFKA_KEYWORDS } from '../lib/commands'

/**
 * The Kafka console's input — the SQL editor's chrome with the Kafka grammar:
 * one command per line, `#` comments, quoted strings and inline JSON.
 *
 * Completion offers commands at the start of a line, then topic or group names
 * where the command takes one, so `CONSUME ord` completes to a real topic.
 */
const kafkaLanguage = StreamLanguage.define({
  name: 'kafka',
  startState: () => ({ atLineStart: true }),
  token(stream, state) {
    if (stream.sol()) state.atLineStart = true
    if (stream.eatSpace()) return null

    if (state.atLineStart && stream.peek() === '#') {
      stream.skipToEnd()
      return 'comment'
    }

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
    if (stream.match(/^[{}[\]:,=<>!~]+/)) return 'punctuation'

    const word = stream.match(/^[^\s"'{}[\]:,=<>!~]+/)
    const text = Array.isArray(word) ? word[0] : String(word || stream.next())
    if (state.atLineStart) {
      state.atLineStart = false
      return KAFKA_COMMAND_NAMES.has(text.toUpperCase()) ? 'keyword' : 'variableName'
    }
    if (/^-?\d+(\.\d+)?$/.test(text)) return 'number'
    if (KAFKA_KEYWORDS.has(text.toUpperCase())) return 'typeName'
    return 'variableName'
  },
})

export default function KafkaEditor({
  value,
  onChange,
  topics = [],
  groups = [],
  editable = true,
  placeholder = 'Type a Kafka command…',
  minHeight = '',
  maxHeight = '460px',
}: {
  value: string
  onChange: (value: string) => void
  topics?: string[]
  groups?: string[]
  editable?: boolean
  placeholder?: string
  minHeight?: string
  maxHeight?: string
}) {
  const extensions = useMemo(() => {
    const complete = (context: any) => {
      const line = context.state.doc.lineAt(context.pos)
      const before = line.text.slice(0, context.pos - line.from)
      const word = context.matchBefore(/[^\s'"]+/)
      const from = word ? word.from : context.pos

      // First token: a command.
      if (!/\s/.test(before.trimStart())) {
        if (!word && !context.explicit) return null
        return {
          from,
          options: KAFKA_COMMANDS.map((c) => ({ label: c.name, type: 'keyword', detail: c.args, info: c.desc, apply: `${c.name} ` })),
          validFor: /^\S*$/,
        }
      }

      // Second token of a command that names a topic or group (or the token after TOPIC/GROUP).
      const tokens = before.trim().split(/\s+/)
      const typing = /\s$/.test(before) ? '' : tokens.pop() || ''
      const prev = (tokens[tokens.length - 1] || '').toUpperCase()
      const takes = tokens.length === 1 ? findKafkaCommand(tokens[0])?.takes : prev === 'TOPIC' ? 'topic' : prev === 'GROUP' ? 'group' : null
      if (!takes) return null
      const names = takes === 'topic' ? topics : groups
      if (!names.length || (!typing && !context.explicit)) return null
      return {
        from,
        options: names.map((n) => ({ label: n, type: takes === 'topic' ? 'class' : 'variable', detail: takes, apply: `${n} ` })),
        validFor: /^[^\s'"]*$/,
      }
    }
    return [
      kafkaLanguage,
      kafkaLanguage.data.of({ autocomplete: complete }),
      Prec.highest(syntaxHighlighting(highlightStyle)),
      EditorView.lineWrapping,
      EditorView.theme({ '.cm-scroller': { minHeight, maxHeight, overflowY: 'auto', overflowX: 'hidden' } }),
      tooltips({ position: 'fixed', parent: document.body }),
    ]
  }, [minHeight, maxHeight, topics, groups])

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
