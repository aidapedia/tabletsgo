// Per-connection named saved queries, persisted to localStorage.

const KEY = (id) => `tabletsgo:saved:${id}`

export function loadSaved(id) {
  if (!id) return []
  try {
    const raw = localStorage.getItem(KEY(id))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function persistSaved(id, list) {
  try {
    localStorage.setItem(KEY(id), JSON.stringify(list))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}
