/**
 * In-app update checking and applying.
 *
 * Detection compares the running (version, sha) against the latest published
 * GitHub Release plus its `release.json` contract. Applying self-updates through
 * the Docker socket when it's mounted; without it the wizard falls back to a
 * manual `docker compose pull`.
 */

import fs from 'fs'
import os from 'os'
import http from 'http'
import {
  APP_VERSION,
  DOCKER_SOCKET,
  GIT_SHA,
  UPDATE_HELPER_IMAGE,
  UPDATE_IMAGE,
  UPDATE_REPO,
} from './config.js'

const UPDATE_CACHE_MS = 30 * 60 * 1000
let updateCache = null // { at, data }

// ---- Apply method ----------------------------------------------------------
// Only offer Docker self-update when the socket is present AND we're actually
// inside a container (avoids a false positive in local dev on a machine that
// happens to run Docker Desktop).
export const dockerSelfUpdateAvailable = () => {
  try {
    return fs.statSync(DOCKER_SOCKET).isSocket() && fs.existsSync('/.dockerenv')
  } catch {
    return false
  }
}

export const updateApplyMethod = () => (dockerSelfUpdateAvailable() ? 'docker' : 'manual')

export const manualUpdateCommand = (tag) => ({
  ok: false,
  method: 'manual',
  command: 'docker compose pull && docker compose up -d',
  image: `${UPDATE_IMAGE}:${tag}`,
})

// ---- Release checking ------------------------------------------------------

async function fetchJson(url, { headers = {}, timeout = 8000 } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'tabletsgo', Accept: 'application/json', ...headers }, signal: ctrl.signal })
    if (!res.ok) throw new Error(`${url} -> ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

const parseSemver = (v) => {
  const m = String(v || '').replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  return m ? [+m[1], +m[2], +m[3]] : null
}

// >0 if a newer than b, <0 if older, 0 if equal/unparseable.
const cmpSemver = (a, b) => {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

// Resolve the update state from GitHub Releases + the release.json contract.
// Never throws — network failure degrades to { unreachable: true }.
async function computeUpdateInfo() {
  const current = { version: APP_VERSION, sha: GIT_SHA }
  const base = {
    current,
    applyMethod: updateApplyMethod(),
    checkedAt: Date.now(),
  }
  try {
    const releases = await fetchJson(`https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=10`)
    const published = (Array.isArray(releases) ? releases : []).filter((r) => !r.draft)
    if (!published.length) {
      return { ...base, latest: null, updateAvailable: false, image: `${UPDATE_IMAGE}:latest`, releases: [] }
    }
    const latestRel = published[0]
    const latestTag = (latestRel.tag_name || '').replace(/^v/, '')

    // release.json is the machine-readable contract; fall back to tag-only.
    let contract = {}
    const asset = (latestRel.assets || []).find((a) => a.name === 'release.json')
    if (asset) {
      try {
        contract = await fetchJson(asset.browser_download_url)
      } catch {
        // Missing/broken contract — treat as a plain tagged release.
      }
    }
    const latest = { version: contract.version || latestTag, sha: contract.sha || null }
    // Update state is purely version-tag driven: a newer release version means
    // an update is available. Same-version rebuilds (moving-tag re-pushes) are
    // intentionally ignored so "v0.16.3 → v0.16.3" never prompts an update.
    const updateAvailable = cmpSemver(latest.version, current.version) > 0

    const minUpgradeFrom = contract.minUpgradeFrom || null
    const upgradeBlocked = !!(minUpgradeFrom && cmpSemver(current.version, minUpgradeFrom) < 0)

    const notes = published
      .filter((r) => cmpSemver((r.tag_name || '').replace(/^v/, ''), current.version) > 0)
      .map((r) => ({
        version: (r.tag_name || '').replace(/^v/, ''),
        name: r.name || r.tag_name,
        notes: r.body || '',
        url: r.html_url,
        publishedAt: r.published_at,
      }))

    return {
      ...base,
      latest,
      updateAvailable,
      breaking: !!contract.breaking,
      migrations: !!contract.migrations,
      minUpgradeFrom,
      upgradeBlocked,
      image: `${UPDATE_IMAGE}:${latest.version}`,
      releases: notes,
    }
  } catch (e) {
    return { ...base, latest: null, updateAvailable: false, unreachable: true, error: e.message, image: `${UPDATE_IMAGE}:latest`, releases: [] }
  }
}

// Cached ~30 min; `refresh` bypasses the cache.
export async function getUpdateInfo({ refresh = false } = {}) {
  if (!refresh && updateCache && Date.now() - updateCache.at < UPDATE_CACHE_MS) return updateCache.data
  const data = await computeUpdateInfo()
  updateCache = { at: Date.now(), data }
  return data
}

// Whatever the last check found, without triggering a new one (pre-flight and
// the apply route read it opportunistically).
export const cachedUpdateInfo = () => updateCache?.data

// ---- Docker socket self-update ---------------------------------------------
// When the Docker socket is mounted into this (containerized) app, it can update
// itself with no external tool: pull the new image, clone the running
// container's resolved config, and hand the final stop/rename/start swap to a
// tiny detached `docker:cli` helper (so the swap survives this process stopping).

// Minimal Docker Engine API client over the unix socket. `raw` returns the body
// as text (used for the streamed image-pull progress).
function dockerApi(method, apiPath, { body, raw = false, timeout = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET,
        path: apiPath,
        method,
        headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
      },
      (res) => {
        let chunks = ''
        res.on('data', (c) => (chunks += c))
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`Docker API ${method} ${apiPath} -> ${res.statusCode}: ${chunks.slice(0, 300)}`))
          if (raw) return resolve(chunks)
          try {
            resolve(chunks ? JSON.parse(chunks) : {})
          } catch {
            resolve(chunks)
          }
        })
      },
    )
    req.setTimeout(timeout, () => req.destroy(new Error(`Docker API ${apiPath} timed out`)))
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

const splitImageRef = (ref) => {
  const slash = ref.lastIndexOf('/')
  const colon = ref.lastIndexOf(':')
  if (colon > slash) return { name: ref.slice(0, colon), tag: ref.slice(colon + 1) }
  return { name: ref, tag: 'latest' }
}

// Self-update via the Docker socket. Throws on any failure so the caller can
// surface a clear error (and the UI can fall back to the manual command).
export async function dockerSelfUpdate() {
  const selfId = process.env.HOSTNAME || os.hostname()
  const inspect = await dockerApi('GET', `/containers/${selfId}/json`)
  const imageRef = inspect.Config?.Image
  if (!imageRef) throw new Error('Could not determine the running image')
  const oldName = (inspect.Name || '').replace(/^\//, '')

  // Pull the current tag (e.g. :latest) so it now resolves to the newest digest,
  // and make sure the helper image is present.
  const { name, tag } = splitImageRef(imageRef)
  await dockerApi('POST', `/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`, { raw: true })
  const helper = splitImageRef(UPDATE_HELPER_IMAGE)
  await dockerApi('POST', `/images/create?fromImage=${encodeURIComponent(helper.name)}&tag=${encodeURIComponent(helper.tag)}`, { raw: true })

  // Clone the running container's resolved config onto the new image. Using the
  // live config (not the compose file) keeps env/secrets intact regardless of
  // how they were supplied.
  const cfg = inspect.Config || {}
  const nets = inspect.NetworkSettings?.Networks || {}
  const shortId = (inspect.Id || '').slice(0, 12)
  const EndpointsConfig = {}
  for (const [netName, n] of Object.entries(nets)) {
    EndpointsConfig[netName] = { Aliases: (n.Aliases || []).filter((a) => a !== shortId) }
  }
  const spec = {
    Image: imageRef,
    Env: cfg.Env,
    Cmd: cfg.Cmd,
    Entrypoint: cfg.Entrypoint,
    Labels: cfg.Labels,
    WorkingDir: cfg.WorkingDir,
    ExposedPorts: cfg.ExposedPorts,
    Volumes: cfg.Volumes,
    HostConfig: inspect.HostConfig,
    NetworkingConfig: { EndpointsConfig },
  }
  const created = await dockerApi('POST', `/containers/create?name=${encodeURIComponent(oldName)}-update-${Date.now()}`, { body: spec })
  const newId = created.Id

  // Hand the swap to a detached helper: it stops+removes us, takes our name, and
  // starts the new container. AutoRemove cleans the helper up afterwards.
  const script = `sleep 2; docker stop ${selfId}; docker rm -f ${selfId}; docker rename ${newId} ${oldName}; docker start ${newId}`
  const helperC = await dockerApi('POST', '/containers/create', {
    body: {
      Image: UPDATE_HELPER_IMAGE,
      Cmd: ['sh', '-c', script],
      HostConfig: { AutoRemove: true, Binds: [`${DOCKER_SOCKET}:/var/run/docker.sock`] },
    },
  })
  await dockerApi('POST', `/containers/${helperC.Id}/start`)
  return { newContainerId: newId }
}
