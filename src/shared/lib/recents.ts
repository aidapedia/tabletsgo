// Per-connection "recent queries" history, persisted to localStorage.

const KEY = (id) => `tabletsgo:recent:${id}`
const MAX = 8

export function loadRecents(id) {
  if (!id) return []
  try {
    const raw = localStorage.getItem(KEY(id))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveRecents(id, list) {
  try {
    localStorage.setItem(KEY(id), JSON.stringify(list))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export function addRecent(id, list, entry) {
  const next = [entry, ...list.filter((e) => e.sql !== entry.sql)].slice(0, MAX)
  saveRecents(id, next)
  return next
}

export function relativeTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} minute${m > 1 ? 's' : ''} ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'Yesterday'
  return `${d} days ago`
}
