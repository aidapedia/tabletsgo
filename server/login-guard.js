/**
 * Brute-force protection for the sign-in route.
 *
 * The state lives on the account (`users.failed_logins / last_failed_at /
 * locked_at / locked_until`) rather than in memory, so a block survives a
 * restart and is visible to an admin in the user list — the two things an
 * in-process counter can't give you.
 *
 * The rule
 *   `LOGIN_MAX_ATTEMPTS` consecutive failures inside `LOGIN_ATTEMPT_WINDOW_MS`
 *   block the account. A failure older than the window doesn't count: the
 *   counter restarts, so someone who mistypes a password twice a week is never
 *   blocked. A successful sign-in clears the counter, and so does any password
 *   change (admin reset or the user's own reset link) — the standard remedy.
 *
 * Who can be blocked
 *   Everyone except an instance admin. Blocking the last admin would leave
 *   nobody able to unblock anyone, so an admin gets `LOGIN_ADMIN_COOLDOWN_MS`
 *   instead: the same threshold, but the lock always expires on its own. That
 *   keeps admin passwords un-brute-forceable *and* keeps an attacker from
 *   locking the instance's operator out on purpose.
 *
 * Enumeration
 *   A blocked account is told it is blocked, which reveals the address exists.
 *   That's deliberate — a person locked out has to know why, and to whom to go.
 *   An unknown address gets the ordinary "invalid email or password" and is
 *   never counted (there is no account to count against).
 */

import {
  LOGIN_ADMIN_COOLDOWN_MS,
  LOGIN_ATTEMPT_WINDOW_MS,
  LOGIN_LOCKOUT_MS,
  LOGIN_MAX_ATTEMPTS,
} from './config.js'
import { meta } from './meta.js'

// Columns every caller needs; kept here so the SELECTs stay in step.
export const LOCK_COLUMNS = 'failed_logins, last_failed_at, locked_at, locked_until'

const isAdmin = (row) => row?.role === 'admin'

const clearRow = (id) =>
  meta
    .prepare('UPDATE users SET failed_logins = 0, last_failed_at = NULL, locked_at = NULL, locked_until = NULL WHERE id = ?')
    .run(id)

const humanDuration = (ms) => {
  const mins = Math.max(1, Math.ceil(ms / 60000))
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`
  const hours = Math.ceil(mins / 60)
  return `${hours} hour${hours === 1 ? '' : 's'}`
}

/**
 * The lock currently in effect on an account, or null.
 *
 * An expired lock is cleared here rather than by a sweeper: it is only ever
 * observed on the sign-in path, so the next attempt is what un-expires it.
 */
export function activeLock(row, now = Date.now()) {
  if (!row?.locked_at) return null
  if (row.locked_until && row.locked_until <= now) {
    clearRow(row.id)
    return null
  }
  return {
    lockedAt: row.locked_at,
    // null = indefinite: only an instance admin lifts it.
    lockedUntil: row.locked_until || null,
    permanent: !row.locked_until,
    attempts: row.failed_logins || 0,
  }
}

/**
 * Refuse a sign-in that a lock forbids. Returns null when the attempt may
 * proceed, otherwise `{ status, body }` for the route to send back verbatim.
 * Checked *before* the password is verified, so a locked account can't be
 * probed and a correct password doesn't quietly bypass the block.
 */
export function loginRefusal(row) {
  const lock = activeLock(row)
  if (!lock) return null
  return {
    status: 423, // Locked
    body: {
      error: lock.permanent
        ? 'This account is blocked after too many failed sign-in attempts. Ask an administrator to unblock it.'
        : `Too many failed sign-in attempts. Try again in ${humanDuration(lock.lockedUntil - Date.now())}.`,
      blocked: true,
      lockedUntil: lock.lockedUntil,
    },
  }
}

/**
 * Count one failed attempt against an account, blocking it once the threshold
 * is reached. Returns the lock it created, or null if the account is still
 * within its allowance.
 */
export function recordFailure(row) {
  if (!row || !LOGIN_MAX_ATTEMPTS) return null
  // An admin with no cooldown configured is never throttled — don't keep a
  // counter that can never fire.
  if (isAdmin(row) && !LOGIN_ADMIN_COOLDOWN_MS) return null

  const now = Date.now()
  const withinWindow = row.last_failed_at && now - row.last_failed_at < LOGIN_ATTEMPT_WINDOW_MS
  const attempts = (withinWindow ? row.failed_logins || 0 : 0) + 1

  if (attempts < LOGIN_MAX_ATTEMPTS) {
    meta.prepare('UPDATE users SET failed_logins = ?, last_failed_at = ? WHERE id = ?').run(attempts, now, row.id)
    return null
  }

  // Threshold reached. An admin's lock always expires; everyone else's lasts
  // until an admin lifts it, unless the operator configured an expiry.
  const until = isAdmin(row) ? now + LOGIN_ADMIN_COOLDOWN_MS : LOGIN_LOCKOUT_MS ? now + LOGIN_LOCKOUT_MS : null
  meta
    .prepare('UPDATE users SET failed_logins = ?, last_failed_at = ?, locked_at = ?, locked_until = ? WHERE id = ?')
    .run(attempts, now, now, until, row.id)
  console.warn(
    `🔒 ${row.username} ${until ? `throttled until ${new Date(until).toISOString()}` : 'blocked'} after ${attempts} failed sign-in attempts`
  )
  return { lockedAt: now, lockedUntil: until, permanent: !until, attempts }
}

// A successful sign-in (or a password change) wipes the slate.
export const clearFailures = (userId) => clearRow(userId)

// Lift a block. Used by the admin route; also the right call after any change
// that hands the account back to its owner.
export const unlockUser = (userId) => clearRow(userId)

// The lock fields as the API reports them (see users.js `toPublic`).
export function lockStatus(row, now = Date.now()) {
  const expired = row?.locked_until && row.locked_until <= now
  return {
    blocked: !!row?.locked_at && !expired,
    blockedAt: row?.locked_at && !expired ? row.locked_at : null,
    blockedUntil: row?.locked_at && !expired ? row.locked_until || null : null,
    failedAttempts: expired ? 0 : row?.failed_logins || 0,
  }
}

// What the login policy is, for anything that needs to explain it.
export const loginPolicy = () => ({
  maxAttempts: LOGIN_MAX_ATTEMPTS,
  windowMs: LOGIN_ATTEMPT_WINDOW_MS,
  lockoutMs: LOGIN_LOCKOUT_MS,
  adminCooldownMs: LOGIN_ADMIN_COOLDOWN_MS,
})
