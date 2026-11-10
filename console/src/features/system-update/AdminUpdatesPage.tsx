import { UpdatePanel } from '@/features/system-update'
import Narrow from '@/shared/ui/page/Narrow'
import { Section } from '@/shared/ui/page/Section'

/**
 * `/admin/updates` — the running version, the changelog and the guided update.
 * Updating is an instance-wide call only an admin can make, so it lives with the
 * instance's settings rather than in anyone's personal ones.
 */
export default function AdminUpdatesPage() {
  return (
    <Section title="Updates" desc="Check for new Tabletsgo releases and update safely.">
      <Narrow>
        <UpdatePanel />
      </Narrow>
    </Section>
  )
}
