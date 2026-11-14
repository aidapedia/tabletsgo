import { useEffect } from 'react'
import { ThemeProvider, useTheme, type AppearanceAnswer } from './ThemeContext'
import { request } from '@/shared/api/request'
import { Toaster } from '@/shared/ui/sonner'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { AuthProvider, useAuth } from '@/features/auth'
import { ModulesProvider } from '@/features/modules'
import { WorkspaceProvider } from '@/features/workspaces'
import { ConnectionsProvider } from '@/features/connections'
import { SettingsProvider } from '@/features/settings'
import { KeymapProvider } from '@/features/keymap'
import { UpdateProvider } from '@/features/system-update'

// Toasts follow the surface actually showing, so the toaster reads the theme.
function AppToaster() {
  const { resolved } = useTheme()
  return <Toaster theme={resolved} />
}

// Once someone is signed in, their account's theme replaces whatever the
// browser painted first. Asked again on every page load, never kept.
function AppearanceSync() {
  const { user } = useAuth()
  const { receive, fail, attempt } = useTheme()
  useEffect(() => {
    if (!user?.id) return
    let live = true
    request<AppearanceAnswer>('/me/appearance')
      .then((answer) => live && receive(answer))
      .catch((error: Error) => live && fail(error.message))
    return () => {
      live = false
    }
  }, [user?.id, receive, fail, attempt])
  return null
}

// Composes every app-wide context provider in one place so the entry point
// (and tests) can wrap the tree with a single component.
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <SettingsProvider>
          <KeymapProvider>
            <AuthProvider>
              <AppearanceSync />
              <ModulesProvider>
                <UpdateProvider>
                  <WorkspaceProvider>
                    <ConnectionsProvider>{children}</ConnectionsProvider>
                  </WorkspaceProvider>
                </UpdateProvider>
              </ModulesProvider>
            </AuthProvider>
          </KeymapProvider>
        </SettingsProvider>
        <AppToaster />
      </TooltipProvider>
    </ThemeProvider>
  )
}
