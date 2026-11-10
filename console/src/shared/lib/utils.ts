import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Join class names, letting later Tailwind classes win over earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Where an overlay (menu, popover, tooltip, dialog) portals to. The Fullscreen
 * API only paints the fullscreened element's subtree, so while one is active a
 * portal on <body> would be invisible — target it instead. `undefined` means
 * Radix's default, <body>.
 */
export function portalContainer(): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined
  return (document.fullscreenElement as HTMLElement | null) ?? undefined
}
