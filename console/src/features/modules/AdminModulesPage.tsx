import { AdminModulesPanel } from '@/features/modules'
import { Section } from '@/shared/ui/page/Section'

/**
 * `/admin/modules` — which databases and features this instance offers, and
 * their instance-wide settings. Workspaces only see what's turned on here: the
 * connection type picker and the Backup tabs follow this page.
 */
export default function AdminModulesPage() {
  return (
    <Section
      title="Modules"
      desc="Choose which databases and features this instance offers. Workspaces only see what’s enabled."
    >
      <AdminModulesPanel />
    </Section>
  )
}
