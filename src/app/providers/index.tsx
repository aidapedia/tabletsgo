import { ThemeProvider } from './ThemeContext'
import { ToastProvider } from '@/shared/ui/Toast'
import { AuthProvider } from '@/features/auth'
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
            <ConnectionsProvider>{children}</ConnectionsProvider>
          </AuthProvider>
        </ToastProvider>
      </SettingsProvider>
    </ThemeProvider>
  )
}
