import TypeToConfirmDialog from '@/shared/ui/feedback/TypeToConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import { clearTopic } from '../lib/api'

/**
 * Type-the-name confirmation for emptying a topic, then the clear itself. The
 * topic stays — its configs, ACLs and consumer groups are untouched; only the
 * messages go. Shared by the sidebar's row menu and a topic tab's menu.
 */
export default function ClearTopicDialog({
  conn,
  topic,
  onClose,
  onCleared,
}: {
  conn: any
  topic: string
  onClose: () => void
  onCleared: (topic: string) => void
}) {
  const toast = useToast()

  const clear = async () => {
    onClose()
    try {
      const r = await clearTopic(conn, topic)
      toast.success(`Cleared ${r.cleared.toLocaleString()} message${r.cleared === 1 ? '' : 's'} from ${topic}.`)
      onCleared(topic)
    } catch (e: any) {
      toast.error(`Clear failed: ${e.message}`)
    }
  }

  return (
    <TypeToConfirmDialog
      title={`Clear every message in "${topic}"?`}
      message="The topic stays with its settings and consumer groups; every message currently in it is deleted. Groups that had not read them yet will skip ahead. This cannot be undone."
      confirmText={topic}
      confirmLabel="Clear messages"
      onConfirm={clear}
      onCancel={onClose}
    />
  )
}
