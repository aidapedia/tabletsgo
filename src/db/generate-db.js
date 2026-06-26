#!/usr/bin/env node
/**
 * Script to generate a sqlite.db file with mock data
 * Usage: node generate-db.js [--postgres|--redis]
 */

import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { POSTGRES_SEED, REDIS_SEED } from './seed-data.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function generateDb() {
  const dbType = process.argv[2]?.replace('--', '') || 'postgres'
  const seed = dbType === 'redis' ? REDIS_SEED : POSTGRES_SEED
  const filename = dbType === 'redis' ? 'redis-mock.db' : 'sqlite-mock.db'
  
  try {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl })
    const db = new SQL.Database()
    
    console.log(`📦 Creating ${dbType.toUpperCase()} database...`)
    db.run(seed)
    
    const data = db.export()
    const buffer = Buffer.from(data)
    const outputPath = path.join(__dirname, '../../public', filename)
    
    // Ensure public directory exists
    const publicDir = path.dirname(outputPath)
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true })
    }
    
    fs.writeFileSync(outputPath, buffer)
    console.log(`✅ Database created: ${outputPath}`)
    console.log(`📊 Size: ${(buffer.length / 1024).toFixed(2)} KB`)
    
    // Print table info
    const getTables = () => {
      const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      return res.length ? res[0].values.map((r) => r[0]) : []
    }
    
    const tables = getTables()
    console.log(`\n📋 Tables created (${tables.length}):`)
    tables.forEach(table => {
      const res = db.exec(`SELECT COUNT(*) FROM "${table}"`)
      const count = res.length ? res[0].values[0][0] : 0
      console.log(`   • ${table}: ${count} rows`)
    })
    
  } catch (error) {
    console.error('❌ Error generating database:', error.message)
    process.exit(1)
  }
}

generateDb()
