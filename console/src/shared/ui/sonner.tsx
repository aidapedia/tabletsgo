import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'

/**
 * The one toaster. Mounted once by the app; anything shows a toast with
 * `toast.success(…)` / `toast.error(…)` / `toast.info(…)` imported from
 * `sonner`. `theme` is the surface actually showing ('system' resolved), which
 * the app layer reads from its ThemeContext.
 */
function Toaster({ theme, ...props }: ToasterProps) {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="bottom-center"
      closeButton
      icons={{
        success: <CircleCheckIcon className="size-4 text-primary-bright" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{ classNames: { toast: 'text-xs' } }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--input)',
          '--border-radius': 'var(--radius)',
        } as CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
