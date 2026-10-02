import { useParams } from 'react-router-dom'
// Imported by path rather than through the feature barrel: the console pulls in
// CodeMirror, React Flow and the charting stack behind its lazy tab bodies, so
// it stays out of `@/features/workspace` for the same reason the heavy editors
// themselves do.
import DatabaseConsole from '@/features/workspace/components/DatabaseConsole'

/**
 * `/connection/:id` — the database console for one connection.
 *
 * Routed outside `HomeLayout` on purpose: the console owns its own icon rail,
 * sidebar and status bar, so it takes the whole viewport rather than sitting
 * inside the shell's padded scroller.
 */
export default function WorkspacePage() {
  const { id } = useParams()
  // Deliberately not keyed by `id`: switching connection keeps the shell (which
  // panel is open, whether the sidebar is collapsed) and resets only what is
  // scoped to the connection — see `switchConnection`.
  return <DatabaseConsole connectionId={id as string} />
}
