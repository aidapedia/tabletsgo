// Chart palette for dashboard widgets — a colorblind-validated 8-slot
// categorical palette with per-theme steps (the dark column is the same hues
// re-stepped for the dark surface, not a separate palette). Both orderings
// were checked with the palette validator against this app's card surfaces
// (#ffffff light / #101010 dark): CVD ΔE >= 8.4, normal-vision ΔE >= 19,
// contrast >= 3:1 on dark. Hues are assigned to series in this fixed order —
// never cycled or re-sorted — so a series keeps its color across refreshes.

import { useEffect, useState } from 'react'

export type ChartPalette = {
  series: string[]
  grid: string
  axis: string
  ink: string
  inkMuted: string
  tooltipBg: string
  tooltipBorder: string
}

const LIGHT: ChartPalette = {
  series: ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948'],
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  ink: '#16181c',
  inkMuted: '#898781',
  tooltipBg: '#ffffff',
  tooltipBorder: '#cdd1cd',
}

const DARK: ChartPalette = {
  series: ['#3987e5', '#008300', '#d55181', '#c98500', '#199e70', '#d95926', '#9085e9', '#e66767'],
  grid: '#2c2c2a',
  axis: '#383835',
  ink: '#f4f4f5',
  inkMuted: '#898781',
  tooltipBg: '#131313',
  tooltipBorder: '#333333',
}

const isDarkNow = () => document.documentElement.classList.contains('dark')

/**
 * The palette for the currently applied theme. ThemeProvider toggles
 * `.light`/`.dark` on <html>, so watch the class attribute — this also covers
 * OS-level changes while the theme is "system".
 */
export function useChartPalette(): ChartPalette {
  const [dark, setDark] = useState(isDarkNow)
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDarkNow()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark ? DARK : LIGHT
}

/**
 * How many distinct series a chart may show — renderers cap at this and fold
 * the remainder (hues are never cycled, so no two series share a color).
 */
export const MAX_SERIES = 8
