// Toggle an id's presence in a selection list (immutable).
export const toggleId = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
