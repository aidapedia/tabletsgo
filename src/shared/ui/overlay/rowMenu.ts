import type { MouseEvent } from 'react'

/**
 * Right-click on a sidebar row opens that row's kebab menu — the same Popover,
 * anchored to the same button, so there is one menu per row, not a second
 * cursor-anchored copy to keep in sync. Mark the kebab trigger with
 * `data-row-menu` + `aria-expanded={open}` and put `onContextMenu={openRowMenu}`
 * on the row (`ListRow` already does). A row without a marked trigger keeps the
 * browser's own menu.
 *
 * Already-open is left alone so right-clicking the kebab itself doesn't toggle
 * it shut; any other press closes it first (useDismiss), so it reopens here.
 */
export function openRowMenu(e: MouseEvent<HTMLElement>) {
  const trigger = e.currentTarget.querySelector<HTMLElement>('[data-row-menu]')
  if (!trigger) return
  e.preventDefault()
  e.stopPropagation()
  if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click()
}
