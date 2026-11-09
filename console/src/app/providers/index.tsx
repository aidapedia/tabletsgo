import { ThemeProvider, useTheme } from './ThemeContext'
import { Toaster } from '@/shared/ui/sonner'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { AuthProvider } from '@/features/auth'
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

// Composes every app-wide context provider in one place so the entry point
// (and tests) can wrap the tree with a single component.
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <SettingsProvider>
          <KeymapProvider>
            <AuthProvider>
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
