import MenuItem from '@/shared/ui/navigation/MenuItem'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CodeIcon, CopyIcon, SendIcon, TrashIcon } from '@/shared/ui/icons'
import { TOPIC_VIEWS, type TopicSubView } from './TopicView'

/**
 * A topic's actions as menu entries — the sidebar row's ⋮ and a topic tab's
 * right-click menu list the same ones. `current` leaves out the view the tab
 * already shows. Every entry calls `close` after acting.
 */
export default function TopicMenuItems({
  topic,
  current,
  close,
  onOpenView,
  onProduce,
  onRunCommand,
  onDelete,
}: {
  topic: string
  current?: TopicSubView
  close: () => void
  onOpenView: (view: TopicSubView) => void
  onProduce: () => void
  onRunCommand: (command: string) => void
  onDelete: () => void
}) {
  const toast = useToast()
  const act = (fn: () => void) => () => {
    fn()
    close()
  }

  return (
    <>
      {TOPIC_VIEWS.filter((v) => v.id !== current).map(({ id, label, icon: Icon }) => (
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
      <div className="my-1 h-px bg-edge" />
      <MenuItem danger onClick={act(onDelete)}>
        <TrashIcon width={14} height={14} /> Delete topic…
      </MenuItem>
    </>
  )
}
