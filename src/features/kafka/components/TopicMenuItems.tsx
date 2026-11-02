import MenuItem from '@/shared/ui/navigation/MenuItem'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CodeIcon, CopyIcon, FolderPlusIcon, RefreshIcon, SendIcon, TrashIcon } from '@/shared/ui/icons'
import { TOPIC_VIEWS, type TopicSubView } from './TopicView'

/**
 * A topic's actions as menu entries — the sidebar row's ⋮. Every entry calls
 * `close` after acting.
 */
export default function TopicMenuItems({
  topic,
  close,
  onOpenView,
  onProduce,
  onRunCommand,
  onClone,
  onClear,
  onDelete,
}: {
  topic: string
  close: () => void
  onOpenView: (view: TopicSubView) => void
  onProduce: () => void
  onRunCommand: (command: string) => void
  /** A new topic seeded from this one's partitions, replication and overrides. */
  onClone: () => void
  /** Empty it, keep it. */
  onClear: () => void
  onDelete: () => void
}) {
  const toast = useToast()
  const act = (fn: () => void) => () => {
    fn()
    close()
  }

  return (
    <>
      {TOPIC_VIEWS.map(({ id, label, icon: Icon }) => (
        <MenuItem key={id} onClick={act(() => onOpenView(id))}>
          <Icon width={14} height={14} /> {label}
        </MenuItem>
      ))}
      <div className="my-1 h-px bg-edge" />
      <MenuItem onClick={act(onProduce)}>
        <SendIcon width={14} height={14} /> Produce message
      </MenuItem>
      <MenuItem onClick={act(() => onRunCommand(`CONSUME ${topic} FROM -20 LIMIT 20`))}>
        <CodeIcon width={14} height={14} /> Consume in console
      </MenuItem>
      <MenuItem onClick={act(() => onRunCommand(`DESCRIBE ${topic}`))}>
        <CodeIcon width={14} height={14} /> Describe in console
      </MenuItem>
      <MenuItem onClick={act(() => navigator.clipboard?.writeText(topic).then(() => toast.success('Copied.')))}>
        <CopyIcon width={14} height={14} /> Copy name
      </MenuItem>
      <MenuItem onClick={act(onClone)}>
        <FolderPlusIcon width={14} height={14} /> Clone topic…
      </MenuItem>
      <div className="my-1 h-px bg-edge" />
      <MenuItem danger onClick={act(onClear)}>
        <RefreshIcon width={14} height={14} /> Clear messages…
      </MenuItem>
      <MenuItem danger onClick={act(onDelete)}>
        <TrashIcon width={14} height={14} /> Delete topic…
      </MenuItem>
    </>
  )
}
