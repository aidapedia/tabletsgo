import { Fragment, type ReactNode } from 'react'

// Tiny markdown renderer for the "Custom Text" widget — headings, lists,
// bold/italic/code, links, and horizontal rules. Builds React elements (no
// innerHTML), so widget text can never inject markup.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  // Tokenize: `code`, **bold**, *italic*, [label](url) — first match wins.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]+\))/g
  let last = 0
  let i = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('`')) {
      out.push(
        <code key={key} className="rounded bg-elevated px-1 py-px font-mono text-[11px] text-ink">
          {tok.slice(1, -1)}
        </code>
      )
    } else if (tok.startsWith('**')) {
      out.push(
        <strong key={key} className="font-semibold text-ink">
          {inline(tok.slice(2, -2), key)}
        </strong>
      )
    } else if (tok.startsWith('*')) {
      out.push(<em key={key}>{inline(tok.slice(1, -1), key)}</em>)
    } else {
      const link = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (link) {
        out.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer" className="text-green underline underline-offset-2">
            {link[1]}
          </a>
        )
      } else {
        out.push(tok)
      }
    }
    last = m.index! + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const H_CLASS = ['text-[15px] font-bold text-ink', 'text-[13px] font-bold text-ink', 'text-xs font-semibold text-ink']

export default function MarkdownText({ text = '' }: { text?: string }) {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let list: string[] | null = null
  let key = 0

  const flushList = () => {
    if (!list) return
    blocks.push(
      <ul key={key++} className="list-disc space-y-1 pl-5">
        {list.map((item, i) => (
          <li key={i}>{inline(item, `li${key}-${i}`)}</li>
        ))}
      </ul>
    )
    list = null
  }

  for (const line of lines) {
    const li = line.match(/^\s*[-*]\s+(.*)$/)
    if (li) {
      ;(list ??= []).push(li[1])
      continue
    }
    flushList()
    if (!line.trim()) continue
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="border-edge" />)
      continue
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      blocks.push(
        <Fragment key={key++}>
          <div className={H_CLASS[h[1].length - 1]}>{inline(h[2], `h${key}`)}</div>
        </Fragment>
      )
      continue
    }
    blocks.push(<p key={key++}>{inline(line, `p${key}`)}</p>)
  }
  flushList()

  return <div className="space-y-2 text-xs leading-relaxed text-ink-dim">{blocks}</div>
}
