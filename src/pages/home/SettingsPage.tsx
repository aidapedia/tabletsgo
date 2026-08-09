import { useParams } from 'react-router-dom'
import { AppearanceSetting, DensitySetting, DataSetting } from '@/features/settings'
import { useAuth, ProfileSetting, PasswordSetting } from '@/features/auth'
import { KeymapSetting } from '@/features/keymap'
import { UpdatePanel } from '@/features/system-update'
import { Narrow, SubHead, TabbedSection } from './ui'
import useTabRoute from './useTabRoute'

/**
 * Personal settings — tabs are a second path segment.
 *
 * Both halves of the app share this page, but not every tab applies to both
 * audiences (see AUTH MODEL): an instance admin holds no workspace membership
 * and never opens a database console, so neither Data (row limits, query
 * timeout) nor Keymap (console shortcuts) has anything to act on; conversely
 * only an admin can apply an update, so a workspace user gets no Updates tab.
 * Account is the one tab that is identical for everyone — it acts on the
 * caller's own row in `users`, not on a role.
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
          <SubHead title="Profile" desc="Your name and sign-in email." />
          <ProfileSetting />
          <div className="mt-10 border-t border-edge pt-8">
            <SubHead title="Password" desc="Change the password you sign in with." />
            <PasswordSetting />
          </div>
        </Narrow>
      ),
    },
    {
      id: 'theme',
      label: 'Theme',
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
    ...(isSystemAdmin
      ? [
          {
            id: 'updates',
            label: 'Updates',
            body: (
              <Narrow>
                <SubHead title="Updates" desc="Check for new Tabletsgo releases and update safely." />
                <UpdatePanel />
              </Narrow>
            ),
          },
        ]
      : []),
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
