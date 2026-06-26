#!/usr/bin/env node
/**
 * Script to create demo.db with sample data
 * Run: node scripts/create-demo-db.js
 */

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { POSTGRES_SEED } from '../src/db/seed-data.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.join(__dirname, '..', 'demo.db')

console.log(`📦 Creating demo SQLite database at ${dbPath}...`)

const db = new Database(dbPath)

// Convert POSTGRES_SEED SQL statements to array and execute
const statements = POSTGRES_SEED.split(';').filter(s => s.trim())
let tableCount = 0

statements.forEach((statement, index) => {
  try {
    if (statement.includes('CREATE TABLE')) {
      tableCount++
    }
    db.exec(statement)
  } catch (error) {
    console.error(`❌ Error in statement ${index}:`, error.message)
  }
})

// Print summary
const tables = db.prepare(`
  SELECT name FROM sqlite_master 
  WHERE type='table' AND name NOT LIKE 'sqlite_%' 
  ORDER BY name
`).all()

console.log(`✅ Database created successfully!`)
console.log(`📊 Tables created: ${tables.length}`)

tables.forEach(table => {
  const count = db.prepare(`SELECT COUNT(*) as count FROM "${table.name}"`).get()
  console.log(`   • ${table.name}: ${count.count} rows`)
})

db.close()
console.log(`\n💾 Database saved to: ${dbPath}`)
