import { useNavigate, useParams } from 'react-router-dom'
import { AppearanceSetting, DensitySetting, DataSetting } from '@/features/settings'
import { KeymapSetting } from '@/features/keymap'
import { UpdatePanel } from '@/features/system-update'
import { SubHead, TabbedSection } from './ui'

// Personal settings — Theme / Data as tabs (a second path segment).
export default function SettingsPage() {
  const navigate = useNavigate()
  const { sub } = useParams()

  const tabs = [
    {
      id: 'theme',
      label: 'Theme',
      body: (
        <div>
          <AppearanceSetting />
          <div className="mt-8">
            <SubHead title="Density" desc="Adjust spacing and text size across the app." />
            <DensitySetting />
          </div>
        </div>
      ),
    },
    {
      id: 'data',
      label: 'Data',
      body: (
        <div>
          <SubHead title="Data" desc="Control how Tabletsgo loads data and runs your changes." />
          <DataSetting />
        </div>
      ),
    },
    {
      id: 'keymap',
      label: 'Keymap',
      body: (
        <div>
          <SubHead title="Keymap" desc="Customize keyboard shortcuts for the workspace and its tools." />
          <KeymapSetting />
        </div>
      ),
    },
    {
      id: 'updates',
      label: 'Updates',
      body: (
        <div>
          <SubHead title="Updates" desc="Check for new Tabletsgo releases and update safely." />
          <UpdatePanel />
        </div>
      ),
    },
  ]

  return (
    <TabbedSection
      title="Setting"
      desc="Personalize how Tabletsgo works for you."
      tabs={tabs}
      active={sub || ''}
      onTab={(id) => navigate(`/settings/${id}`)}
    />
  )
}
