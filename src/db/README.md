# SQLite Mock Data

This directory contains SQLite database utilities and mock data for development and testing.

## Files

### `sqlite.js`
Main database module that provides:
- `getDb(conn)` - Get or create an in-memory database for a connection
- `listTables(db)` - List all tables in the database
- `tableRowCount(db, table)` - Get row count for a table
- `getTableData(db, table, limit)` - Get table data with optional limit
- `runQuery(db, sql)` - Execute arbitrary SQL queries

Uses seed data from `seed-data.js` to initialize PostgreSQL and Redis mock databases.

### `seed-data.js`
Contains comprehensive mock data exported as SQL strings:
- **POSTGRES_SEED** - Event management system with 7 sample events, 14 participants, sessions, orders, payments, notifications, and analytics
- **REDIS_SEED** - Cache/session data with keys, expiration times, and server metrics

#### PostgreSQL Tables
- `events` - 7 sample events (conferences, workshops, meetups)
- `event_participants` - 14 attendees with registration details
- `event_sessions` - 10 scheduled sessions with speakers
- `event_templates` - Badge and banner templates
- `orders` - 13 sample orders/tickets
- `payment_methods` - 7 payment options
- `notifications` - 8 notification records
- `attributes` - 8 custom form fields
- `analytics` - Event engagement metrics

#### Redis Tables (sql.js simulation)
- `keys` - 16 sample cache/session keys with TTLs
- `info` - Server metrics and statistics

## Generate a .db File

To create an exportable SQLite database file:

```bash
node src/db/generate-db.js          # Creates sqlite-mock.db
node src/db/generate-db.js --postgres  # PostgreSQL mock data
node src/db/generate-db.js --redis   # Redis mock data
```

Generated files are saved to `public/` directory.

## Usage in Your App

The mock data is automatically used when creating database connections:

```javascript
import { getDb } from './src/db/sqlite.js'

const db = await getDb({ id: 'conn1', type: 'postgresql' })
const tables = listTables(db)
const data = getTableData(db, 'events')
```

## Mock Data Details

### Sample Participants
- Aisha Rahman, Budi Santoso, Clara Wijaya, Dimas Pratama, Eka Putri
- Farhan Idris, Gita Lestari, Hendra Wijaya, Ira Sukmana, Jaka Atmaja
- Karin Sulistyo, Lenny Gunawan, Mega Indah, Nina Kusuma

### Sample Events (Jun-Sep 2026)
- Tech Summit 2026 (500 capacity)
- Product Workshop (80 capacity)
- Annual Gala (300 capacity)
- Dev Meetup #14 (120 capacity)
- AI Workshop Series (150 capacity)
- Startup Pitch Night (200 capacity)

### Sample Data Relationships
- Events → Participants → Orders → Payments
- Events → Sessions → Speakers
- Orders → Payment Methods & Notifications
- Participants → Attributes (custom fields)

## Customization

To add more mock data:

1. Edit `seed-data.js`
2. Add INSERT statements to POSTGRES_SEED or REDIS_SEED
3. Update table schema if adding new fields
4. Regenerate .db file if needed: `node src/db/generate-db.js`

## Notes

- Data uses realistic Indonesian-based names and companies
- All timestamps are in YYYY-MM-DD HH:MM format
- Dates are set in 2026 for consistency
- Currency defaults to IDR (Indonesian Rupiah)
- Data persists in-memory during session (not saved to disk unless exported)
