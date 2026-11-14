import { useParams } from 'react-router-dom'
import { AppearanceSetting, DensitySetting, DataSetting } from '@/features/settings'
import { useAuth, AccountSetting } from '@/features/auth'
import { KeymapSetting } from '@/features/keymap'
import Narrow from '@/shared/ui/page/Narrow'
import { SubHead, TabbedSection } from '@/shared/ui/page/Section'
import useTabRoute from '@/shared/hooks/useTabRoute'

/**
 * Personal settings — tabs are a second path segment.
 *
 * Both halves of the app share this page, but not every tab applies to both
 * audiences (see AUTH MODEL): an instance admin holds no workspace membership
 * and never opens a database console, so neither Data (direct execute) nor
 * Keymap (console shortcuts) has anything to act on. Updates aren't here at all:
 * they're the instance's, not a person's (see `AdminUpdatesPage`).
 * Account and Preferences are identical for everyone. The account itself — name,
 * password, time zone, sign-in methods — lives in Hayat, so its tab shows it and
 * links there; Preferences are this browser's.
 */
export default function SettingsPage() {
  const { sub } = useParams()
  const { user } = useAuth()
  const isSystemAdmin = user?.role === 'admin'

  const tabs = [
    {
      id: 'account',
      label: 'Account',
      body: (
        <Narrow>
          <SubHead title="Account" desc="Who you are signed in as." />
          <AccountSetting />
        </Narrow>
      ),
    },
    {
      id: 'preferences',
      label: 'Preferences',
      body: (
        <Narrow>
          <AppearanceSetting />
          <div className="mt-8">
            <SubHead title="Density" desc="Adjust spacing and text size across the app." />
            <DensitySetting />
          </div>
        </Narrow>
      ),
    },
    ...(isSystemAdmin
      ? []
      : [
          {
            id: 'data',
            label: 'Data',
            body: (
              <Narrow>
                <SubHead title="Data" desc="Control how Tabletsgo loads data and runs your changes." />
                <DataSetting />
              </Narrow>
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
        ]),
  ]

  const { active, onTab } = useTabRoute('/settings', tabs, sub)

  return (
    <TabbedSection
      title="Setting"
      desc="Personalize how Tabletsgo works for you."
      tabs={tabs}
      active={active}
      onTab={onTab}
    />
  )
}
