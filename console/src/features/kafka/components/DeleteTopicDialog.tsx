import { toast } from 'sonner'
import { deleteTopic } from '../lib/api'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

/**
 * Type-the-name confirmation for deleting a topic, then the delete itself.
 * Shared by the topic tab's right-click menu and the sidebar's row menu.
 */
export default function DeleteTopicDialog({
  conn,
  topic,
  partitions,
  onClose,
  onDeleted,
}: {
  conn: any
  topic: string
  partitions?: number
  onClose: () => void
  onDeleted: (topic: string) => void
}) {

  const remove = async () => {
    onClose()
    try {
      await deleteTopic(conn, topic)
      toast.success(`Deleted topic ${topic}.`)
      onDeleted(topic)
    } catch (e: any) {
      toast.error(`Delete failed: ${e.message}`)
    }
  }

  return (
    <ConfirmDialog destructive
      title={`Delete topic "${topic}"?`}
      description={`Every message in all ${partitions ?? ''} partitions is deleted with it, and consumers reading it will fail. This cannot be undone.`}
      typeToConfirm={topic}
      confirmLabel="Delete topic"
      onConfirm={remove}
      onCancel={onClose}
    />
  )
}
