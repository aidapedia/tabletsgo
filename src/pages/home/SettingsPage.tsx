import { useParams } from 'react-router-dom'
import { AppearanceSetting, DensitySetting, DataSetting } from '@/features/settings'
import { useAuth, ProfileSetting, PasswordSetting, SignInMethods, TimeZoneSetting } from '@/features/auth'
import { KeymapSetting } from '@/features/keymap'
import { Narrow, SubHead, TabbedSection } from './ui'
import useTabRoute from './useTabRoute'

/**
 * Personal settings — tabs are a second path segment.
 *
 * Both halves of the app share this page, but not every tab applies to both
 * audiences (see AUTH MODEL): an instance admin holds no workspace membership
 * and never opens a database console, so neither Data (direct execute) nor
 * Keymap (console shortcuts) has anything to act on. Updates aren't here at all:
 * they're the instance's, not a person's (see `AdminUpdatesPage`).
 * Profile, Security and Preferences are identical for everyone — they act on the
 * caller's own account and browser, not on a role.
 */
export default function SettingsPage() {
  const { sub } = useParams()
  const { user } = useAuth()
  const isSystemAdmin = user?.role === 'admin'

  const tabs = [
    {
      id: 'profile',
      label: 'Profile',
      body: (
        <Narrow>
          <SubHead title="Profile" desc="Your name and sign-in email." />
          <ProfileSetting />
        </Narrow>
      ),
    },
    {
      id: 'security',
      label: 'Security',
      body: (
        <Narrow>
          <SubHead title="Password" desc="Change the password you sign in with." />
          <PasswordSetting />
          <div className="mt-10 border-t border-edge pt-8">
            <SubHead title="Sign-in methods" desc="Google and GitHub accounts you can sign in with." />
            <SignInMethods />
          </div>
        </Narrow>
      ),
    },
    {
      id: 'preferences',
      label: 'Preferences',
      body: (
        <Narrow>
          <SubHead title="Time zone" desc="Times across the app show in this zone." />
          <TimeZoneSetting />
          <div className="mt-10 border-t border-edge pt-8">
            <AppearanceSetting />
          </div>
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
