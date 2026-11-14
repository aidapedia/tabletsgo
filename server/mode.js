/**
 * The instance's mode — 'solo' or 'enterprise' — as the migrator resolved and
 * recorded it on boot (server/migrator/identity.js, run from boot.js before
 * anything else is evaluated).
 *
 *   solo        one person, signed in by password; server/hayat answers every
 *               question in-process (server/hayat/solo-backend.js)
 *   enterprise  Hayat owns accounts, workspaces, roles and grants
 *
 * A leaf: it imports nothing, so anything may ask. No route branches on it —
 * server/hayat and server/solo.js answer for both (CLAUDE.md "INVARIANTS").
 */

let current = null

export const setMode = (mode) => {
  current = mode
}

/** 'solo' | 'enterprise' | null (not resolved: a test, or a script). */
export const mode = () => current

export const isSolo = () => current === 'solo'
