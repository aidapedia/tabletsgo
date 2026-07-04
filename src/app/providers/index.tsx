import { ThemeProvider } from './ThemeContext'
import { ToastProvider } from '@/shared/ui/feedback/Toast'
import { AuthProvider } from '@/features/auth'
import { WorkspaceProvider } from '@/features/workspaces'
import { ConnectionsProvider } from '@/features/connections'
import { SettingsProvider } from '@/features/settings'

// Composes every app-wide context provider in one place so the entry point
// (and tests) can wrap the tree with a single component.
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <ToastProvider>
          <AuthProvider>
            <WorkspaceProvider>
              <ConnectionsProvider>{children}</ConnectionsProvider>
            </WorkspaceProvider>
          </AuthProvider>
        </ToastProvider>
      </SettingsProvider>
    </ThemeProvider>
  )
}
