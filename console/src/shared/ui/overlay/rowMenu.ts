import type { MouseEvent } from 'react'

/**
 * Right-click on a sidebar row opens that row's kebab menu — the same menu,
 * anchored to the same button, so there is one menu per row, not a second
 * cursor-anchored copy to keep in sync. Mark the kebab trigger with
 * `data-row-menu` and put `onContextMenu={openRowMenu}` on the row (`ListRow`
 * already does). A row without a marked trigger keeps the browser's own menu.
 *
 * A shadcn DropdownMenu trigger opens on pointerdown (not click), so that is
 * what it is sent; a Popover trigger is clicked. Already-open is left alone, so
 * right-clicking the kebab itself doesn't toggle it shut.
 */
export function openRowMenu(e: MouseEvent<HTMLElement>) {
  const trigger = e.currentTarget.querySelector<HTMLElement>('[data-row-menu]')
  if (!trigger) return
  e.preventDefault()
  e.stopPropagation()
  if (trigger.getAttribute('aria-expanded') === 'true') return
  if (trigger.dataset.slot === 'dropdown-menu-trigger') {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }))
  } else trigger.click()
}
