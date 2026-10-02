/**
 * Synchronous PostgreSQL handle with the better-sqlite3 call surface. The app
 * reads and writes through Prisma (server/meta.js); this exists for the
 * migrator, whose frozen legacy steps were written against that surface.
 */
import fs from 'fs'
import { spawnSync } from 'child_process'
import PgNative from 'pg-native'
import pgTypes from 'pg-types'
import { postgresSql } from './postgres-sql.js'

const types = { getTypeParser: (oid, format) => oid === 20 ? Number : pgTypes.getTypeParser(oid, format) }

export class PostgresMeta {
  constructor(url) {
    this.url = url
    this.client = new PgNative({ types })
    this.client.connectSync(url)
    this.depth = 0
  }

  prepare(sql) {
    const translated = postgresSql(sql)
    const query = (...values) => this.client.querySync(translated, values.length ? values : undefined)
    return {
      get: (...values) => query(...values)[0],
      all: (...values) => query(...values),
      run: (...values) => {
        if (!/^\s*(INSERT|UPDATE|DELETE)\b/i.test(translated)) throw new Error('run() requires a mutation')
        const counted = /\bRETURNING\b/i.test(translated) ? translated : `${translated.trimEnd()} RETURNING 1`
        const rows = this.client.querySync(counted, values.length ? values : undefined)
        return { changes: rows.length }
      },
    }
  }

  exec(sql) { return this.client.querySync(sql) }

  transaction(fn) {
    return (...args) => {
      const depth = this.depth
      const savepoint = `meta_sp_${depth}`
      this.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`)
      this.depth++
      try {
        const value = fn(...args)
        this.exec(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`)
        return value
      } catch (error) {
        this.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${savepoint}`)
        if (depth !== 0) this.exec(`RELEASE SAVEPOINT ${savepoint}`)
        throw error
      } finally {
        this.depth--
      }
    }
  }

  backup(destPath) {
    const url = new URL(this.url)
    const password = decodeURIComponent(url.password)
    url.password = ''
    const schema = this.prepare('SELECT current_schema() AS name').get().name
    const result = spawnSync('pg_dump', ['--format=custom', '--schema', schema, '--file', destPath, '--dbname', url.toString()], {
      env: { ...process.env, ...(password ? { PGPASSWORD: password } : {}) },
      encoding: 'utf8',
    })
    if (result.error || result.status !== 0) {
      try { fs.unlinkSync(destPath) } catch {}
      throw new Error(result.error?.message || result.stderr?.trim() || 'pg_dump failed')
    }
    return fs.statSync(destPath).size
  }

  close() { this.client.end() }
}
