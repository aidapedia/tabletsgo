import { useMemo, type ReactNode } from 'react'
import {
  Command as CommandRoot,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/shared/ui/command'

export interface Command {
  id: string
  label: string
  /** Section header this command sits under (e.g. "Create", "Navigate"). */
  group?: string
  /** Extra text to match against beyond the label (synonyms, e.g. "erd diagram"). */
  keywords?: string
  /** Small right-aligned hint, typically a formatted shortcut like ⌘N. */
  hint?: string
  icon?: ReactNode
  run: () => void
}

// A generic command palette — shadcn's CommandDialog (cmdk): filtered as you
// type, grouped by `group`, ↑/↓ to move, Enter to run, Esc to close.
// Feature-agnostic — callers pass whatever commands make sense for their screen.
export default function CommandPalette({
  open,
  onClose,
  commands,
  placeholder = 'Search or run a command…',
}: {
  open: boolean
  onClose: () => void
  commands: Command[]
  placeholder?: string
}) {
  // Groups in the order they first appear, so callers control the layout.
  const groups = useMemo(() => {
    const out = new Map<string, Command[]>()
    for (const c of commands) {
      const g = c.group ?? ''
      if (!out.has(g)) out.set(g, [])
      out.get(g)!.push(c)
    }
    return [...out]
  }, [commands])

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Command palette"
      className="top-[12vh] border-input bg-sidebar sm:max-w-[560px]"
    >
      <CommandRoot>
        <CommandInput placeholder={placeholder} className="text-[13px]" />
        <CommandList className="max-h-[52vh]">
          <CommandEmpty className="py-6 text-center text-xs text-faint">No matching commands</CommandEmpty>
          {groups.map(([group, items]) => (
            <CommandGroup key={group || '_'} heading={group || undefined}>
              {items.map((cmd) => (
                <CommandItem
                  key={cmd.id}
                  value={`${cmd.label} ${cmd.id}`}
                  keywords={[cmd.group ?? '', cmd.keywords ?? ''].filter(Boolean)}
                  onSelect={() => {
                    onClose()
                    cmd.run()
                  }}
                  className="gap-2.5 text-[13px]"
                >
                  {cmd.icon && <span className="flex w-4 shrink-0 justify-center text-faint">{cmd.icon}</span>}
                  <span className="min-w-0 flex-1 truncate">{cmd.label}</span>
                  {cmd.hint && <CommandShortcut>{cmd.hint}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandRoot>
    </CommandDialog>
  )
}
