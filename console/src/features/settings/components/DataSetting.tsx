import { useSettings } from '@/features/settings'
import SettingRow from '@/shared/ui/form/SettingRow'
import { Switch } from '@/shared/ui/switch'

// Data / query-execution settings (no section chrome). The table row limit and
// query timeout aren't here: an instance admin sets them per database type.
export default function DataSetting() {
  const { directExecute, setDirectExecute } = useSettings()

  return (
    <div className="space-y-3">
      <SettingRow
        title="Direct execute"
        desc="Run data and schema changes immediately instead of staging them in the Changes panel for a later commit."
      >
        <Switch checked={directExecute} onCheckedChange={(checked) => setDirectExecute(checked === true)} aria-label="direct execute" />
      </SettingRow>
      <p className="text-[11px] leading-relaxed text-faint">
        The table row limit and query timeout are set per database type by your instance administrator.
      </p>
    </div>
  )
}
