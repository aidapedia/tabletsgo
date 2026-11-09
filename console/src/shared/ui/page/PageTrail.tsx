import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import type { Crumb } from '../navigation/Breadcrumb'

/**
 * How a page tells the shell what the address alone can't: a record's name.
 *
 * `HomeLayout` draws the one trail above every page, so it is there on a loading
 * or "no longer exists" state too. It works out the root and the section itself;
 * a page only adds what comes after them, which `PageHeader`'s `crumbs` does.
 *
 * The setter has its own context so publishing can't loop: a page re-renders with
 * a fresh `crumbs` array, the provider re-renders, but `children` is the same
 * element and the page reads only the setter, so only the trail itself updates.
 */
const SetCrumbs = createContext<(crumbs: Crumb[]) => void>(() => {})
const Crumbs = createContext<Crumb[]>([])

export function PageTrailProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  return (
    <SetCrumbs.Provider value={setCrumbs}>
      <Crumbs.Provider value={crumbs}>{children}</Crumbs.Provider>
    </SetCrumbs.Provider>
  )
}

export const usePageCrumbs = () => useContext(Crumbs)

// Layout effect, not effect: the trail has to change in the same paint as the
// page, or it shows the previous record's name for a frame.
export function useSetPageCrumbs(crumbs: Crumb[] | undefined) {
  const set = useContext(SetCrumbs)
  useLayoutEffect(() => {
    if (!crumbs?.length) return
    set(crumbs)
    return () => set([])
  }, [crumbs, set])
}
