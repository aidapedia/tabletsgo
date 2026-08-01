import { useNavigate, useParams } from 'react-router-dom'
import { AppearanceSetting, DensitySetting, DataSetting } from '@/features/settings'
import { useAuth } from '@/features/auth'
import { KeymapSetting } from '@/features/keymap'
import { UpdatePanel } from '@/features/system-update'
import { SubHead, TabbedSection } from './ui'

/**
 * Personal settings — tabs are a second path segment.
 *
 * Both halves of the app share this page, but not every tab applies to both
 * audiences (see AUTH MODEL): an instance admin holds no workspace membership
 * and never opens a database console, so Data (row limits, query timeout) has
 * nothing to act on; conversely only an admin can apply an update, so a
 * workspace user gets no Updates tab.
 */
export default function SettingsPage() {
  const navigate = useNavigate()
  const { sub } = useParams()
  const { user } = useAuth()
  const isSystemAdmin = user?.role === 'admin'

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
    ...(isSystemAdmin
      ? []
      : [
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
        ]),
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
    ...(isSystemAdmin
      ? [
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
      : []),
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
