import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { mysqlConfig, mysqlDriver, mysqlLiteral, quoteIdent } from '../server/db/mysql.js'
import { classifyStatement } from '../server/db/sql.js'

// server/workflow.js reads config (and so the env) on import; keep it off real paths.
process.env.ENCRYPTION_KEY = 'mysql-test-key'
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tabletsgo-mysql-'))
const { substituteWorkflowInput } = await import('../server/workflow.js')

// The pure half runs everywhere. The rest talks to a real server, so it needs
//   MYSQL_TEST_URL=mysql://root:secret@127.0.0.1:3306/scratch npm test
// and it owns that database: it drops and recreates its tables.
const url = process.env.MYSQL_TEST_URL ? new URL(process.env.MYSQL_TEST_URL) : null
const conn = url && {
  id: 'mysql-test',
  type: 'mysql',
  host: url.hostname,
  port: url.port,
  username: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
}
const ctx = {}
const live = { skip: url ? false : 'set MYSQL_TEST_URL to run' }

const run = async (sql) => {
  const r = await mysqlDriver.runQuery(conn, ctx, sql)
  assert.equal(r.error, undefined, r.error)
  return r
}

test('identifiers are backticked and backticks doubled', () => {
  assert.equal(quoteIdent('a`b'), '`a``b`')
})

test('a string literal cannot be escaped out of with a backslash', () => {
  assert.equal(mysqlLiteral("it's"), "'it''s'")
  assert.equal(mysqlLiteral('a\\'), "'a\\\\'")
  assert.equal(mysqlLiteral("\\' OR 1=1 -- "), "'\\\\'' OR 1=1 -- '")
  assert.equal(mysqlLiteral(5), '5')
  assert.equal(mysqlLiteral(null), 'NULL')
  assert.equal(mysqlLiteral({ a: '\\' }), `'{"a":"\\\\\\\\"}'`)
})

test('workflow input is written in the engine\'s own quoting', () => {
  const sql = 'SELECT {{input.a}} FROM {{input.t:ident}}'
  assert.equal(substituteWorkflowInput(sql, { a: "x\\'", t: 'o`rders' }, { quote: quoteIdent, literal: mysqlLiteral }), "SELECT 'x\\\\''' FROM `o``rders`")
})

test('a tunneled connection dials the local end but verifies the real name', () => {
  const cfg = mysqlConfig({ host: '127.0.0.1', port: 40000, tunneledHost: 'db.example.com', sslmode: 'verify-full' })
  assert.equal(cfg.host, 'db.example.com')
  assert.equal(typeof cfg.stream, 'function')
  assert.deepEqual(cfg.ssl, { rejectUnauthorized: true, verifyIdentity: true })
  assert.equal(mysqlConfig({ host: 'h', sslmode: 'disable' }).ssl, undefined)
  assert.deepEqual(mysqlConfig({ host: 'h', sslmode: 'require' }).ssl, { rejectUnauthorized: false, verifyIdentity: false })
})

before(async () => {
  if (!url) return
  // Start from an empty database: whatever an earlier run (or anyone) left in it
  // would show up in the listings below.
  const { rows: leftovers } = await run(
    `SELECT TABLE_NAME AS name, TABLE_TYPE AS kind FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`
  )
  const drops = leftovers.map((t) => `DROP ${t.kind === 'VIEW' ? 'VIEW' : 'TABLE'} IF EXISTS ${quoteIdent(t.name)};`)
  await mysqlDriver.runScript(conn, ctx, `
    SET FOREIGN_KEY_CHECKS = 0;
    ${drops.join('\n    ')}
    DROP FUNCTION IF EXISTS add_tax;
    DROP PROCEDURE IF EXISTS two_sets;
    SET FOREIGN_KEY_CHECKS = 1;
    CREATE TABLE customers (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(190) NOT NULL UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'lifecycle',
      bio TEXT,
      score DECIMAL(10,2) DEFAULT 1.50,
      flags BIT(8) DEFAULT b'101',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      token CHAR(36) DEFAULT (UUID()),
      KEY idx_status (status),
      KEY idx_bio (bio(16)),
      FULLTEXT KEY ft_bio (bio),
      KEY idx_lower ((LOWER(status)))
    );
    CREATE TABLE orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customer_id BIGINT UNSIGNED NOT NULL,
      total DECIMAL(10,2) NOT NULL,
      CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
    );
    CREATE TABLE no_pk (a INT, b VARCHAR(10));
    CREATE VIEW order_totals AS SELECT customer_id, SUM(total) AS spent FROM orders GROUP BY customer_id;
    CREATE FUNCTION add_tax(amount DECIMAL(10,2)) RETURNS DECIMAL(10,2) DETERMINISTIC RETURN amount * 1.1;
    CREATE PROCEDURE two_sets() BEGIN SELECT 1 AS first_set; SELECT 2 AS second_set; END;
    INSERT INTO customers (email, bio) VALUES ('a@x.io', 'hello'), ('b@x.io', NULL);
    INSERT INTO orders (customer_id, total) VALUES (1, 10.00), (1, 5.50), (2, 1.25);
    INSERT INTO no_pk VALUES (1, 'x'), (1, 'x'), (2, 'y');
    -- a comment after the last statement
  `)
})

after(() => {
  if (url) mysqlDriver.closeAll()
})

test('identity and namespaces', live, async () => {
  assert.match(await mysqlDriver.serverVersion(conn, ctx), /^\d+\.\d+/)
  const ns = await mysqlDriver.namespaces(conn, ctx)
  assert.equal(ns.currentDatabase, conn.database)
  assert.deepEqual(ns.schemas, [])
  assert.ok(ns.databases.includes(conn.database))
  assert.ok(!ns.databases.includes('performance_schema'))
  assert.deepEqual(await mysqlDriver.testConnection(conn), { ok: true, message: `Connected to MySQL (${conn.database})!` })
})

test('a connection naming no database can still list them and browse one', live, async () => {
  const bare = { ...conn, id: 'mysql-test-bare', database: '' }
  const ns = await mysqlDriver.namespaces(bare, {})
  assert.equal(ns.currentDatabase, null)
  assert.ok((await mysqlDriver.listTables(bare, { database: conn.database })).includes('orders'))
  mysqlDriver.release(bare)
})

test('objects, routines and the schema map', live, async () => {
  const objects = await mysqlDriver.listObjects(conn, ctx)
  assert.ok(objects.some((o) => o.name === 'orders' && o.type === 'table'))
  assert.ok(objects.some((o) => o.name === 'order_totals' && o.type === 'view'))
  assert.ok(objects.some((o) => o.name === 'add_tax' && o.type === 'function' && /amount decimal/i.test(o.detail)))
  assert.ok(objects.some((o) => o.name === 'two_sets' && o.type === 'function'))
  const [fn] = await mysqlDriver.listFunctions(conn, ctx, 'add_tax')
  assert.match(fn.definition, /CREATE .*FUNCTION/)
  assert.deepEqual((await mysqlDriver.listFunctions(conn, ctx, 'two_sets')).length, 1)
  assert.ok(!(await mysqlDriver.listTables(conn, ctx)).includes('order_totals'))
  assert.deepEqual((await mysqlDriver.getSchemaMap(conn, ctx)).orders, ['id', 'customer_id', 'total'])
})

test('columns come back ready for DDL', live, async () => {
  const cols = Object.fromEntries((await mysqlDriver.getColumns(conn, ctx, 'customers')).map((c) => [c.name, c]))
  assert.equal(cols.id.type, 'bigint unsigned')
  assert.equal(cols.id.pk, true)
  assert.equal(cols.id.autoIncrement, true)
  assert.equal(cols.id.extra, 'AUTO_INCREMENT')
  assert.equal(cols.status.default, "'active'")
  assert.equal(cols.status.extra, "COMMENT 'lifecycle'")
  assert.equal(cols.score.default, '1.50')
  assert.equal(cols.flags.default, "b'101'")
  assert.equal(cols.created_at.default, 'CURRENT_TIMESTAMP')
  assert.equal(cols.created_at.extra, 'ON UPDATE CURRENT_TIMESTAMP')
  assert.match(cols.token.default, /^\(uuid\(\)\)$/i)
  assert.equal(cols.bio.default, null)
  const [, fk] = await mysqlDriver.getColumns(conn, ctx, 'orders')
  assert.deepEqual(fk.references, { table: 'customers', column: 'id' })
})

test('indexes: droppable ones are plain, the rest say why not', live, async () => {
  const idx = Object.fromEntries((await mysqlDriver.getIndexes(conn, ctx, 'customers')).map((i) => [i.name, i]))
  assert.equal(idx.PRIMARY.primary, true)
  assert.equal(idx.PRIMARY.constraint, true)
  assert.equal(idx.email.unique, true)
  assert.equal(idx.email.constraint, false)
  assert.equal(idx.idx_status.locked, undefined)
  assert.equal(idx.idx_status.algorithm, 'BTREE')
  assert.equal(idx.idx_bio.locked, 'prefix')
  assert.equal(idx.idx_bio.columns, 'bio(16)')
  assert.equal(idx.ft_bio.locked, 'fulltext')
  assert.equal(idx.idx_lower.locked, 'expression')
})

test('the diagram names tables, indexes and foreign keys, and slices', live, async () => {
  const all = await mysqlDriver.getDiagram(conn, ctx)
  assert.deepEqual(all.tables.map((t) => t.name).sort(), ['customers', 'no_pk', 'orders'])
  assert.deepEqual(all.foreignKeys, [
    { constraint: 'fk_orders_customer', table: 'orders', column: 'customer_id', refTable: 'customers', refColumn: 'id', onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
  ])
  const slice = await mysqlDriver.getDiagram(conn, ctx, { tables: ['no_pk'] })
  assert.deepEqual(slice.tables.map((t) => t.name), ['no_pk'])
  assert.deepEqual(slice.foreignKeys, [])
  assert.deepEqual(await mysqlDriver.getDiagram(conn, ctx, { tables: ['absent'] }), { tables: [], foreignKeys: [] })
})

test('table data is ordered by the primary key and pages by offset', live, async () => {
  const page = await mysqlDriver.getTableData(conn, ctx, { table: 'orders', limit: 2, offset: 1 })
  assert.deepEqual(page.columns, ['id', 'customer_id', 'total'])
  assert.deepEqual(page.rows.map((r) => r.id), [2, 3])
  assert.equal(page.rows[0].total, '5.50') // a decimal stays exact
  const view = await mysqlDriver.getTableData(conn, ctx, { table: 'order_totals' })
  assert.deepEqual(view.columns, ['customer_id', 'spent'])
  assert.match((await mysqlDriver.getTableData(conn, ctx, { table: 'absent' })).error, /doesn't exist/)
})

test('values read as stored', live, async () => {
  const { rows } = await run(`SELECT flags, created_at, CAST('{"a":1}' AS JSON) AS doc, TIMESTAMP'2024-03-01 10:20:30' AS at FROM customers WHERE id = 1`)
  assert.equal(rows[0].flags, '5')
  assert.equal(rows[0].at, '2024-03-01 10:20:30')
  assert.deepEqual(rows[0].doc, { a: 1 })
  assert.equal(typeof rows[0].created_at, 'string')
  const big = (await run('SELECT 9007199254740993 AS big, COUNT(*) AS n FROM customers')).rows[0]
  assert.equal(big.big, '9007199254740993') // a double would round it
  assert.equal(big.n, 2)
})

test('results take every shape the console can ask for', live, async () => {
  assert.deepEqual(await run('SELECT 1 + 1 AS two'), { type: 'rows', columns: ['two'], rows: [{ two: 2 }] })
  assert.equal((await run("SELECT '?' AS q")).rows[0].q, '?') // no placeholder without values
  assert.deepEqual(await run("UPDATE no_pk SET b = 'x' WHERE a = 999"), { type: 'message', message: 'Query OK · 0 row(s) affected.', rowCount: 0 })
  assert.equal((await run('SELECT 1 AS a; SELECT 2 AS b;')).rows[0].b, 2)
  assert.equal((await run('CALL two_sets()')).rows[0].second_set, 2)
  assert.equal((await run('SHOW TABLES')).type, 'rows')
  assert.equal((await run("UPDATE no_pk SET b = 'z' WHERE a = 2; UPDATE no_pk SET b = 'y' WHERE a = 2;")).rowCount, 2)
  assert.match((await mysqlDriver.runQuery(conn, ctx, 'SELEC 1')).error, /SQL syntax/)
})

test('session state never reaches the next request', live, async () => {
  const fresh = { ...conn, id: 'mysql-test-session' }
  const again = () => mysqlDriver.runQuery(fresh, ctx, 'SELECT DATABASE() AS db, @leak AS leak, @@autocommit AS auto')
  assert.equal((await mysqlDriver.runQuery(fresh, ctx, 'SET @leak = 1; USE mysql; SELECT DATABASE() AS db')).rows[0].db, 'mysql')
  await mysqlDriver.runQuery(fresh, ctx, 'SET autocommit = 0')
  await mysqlDriver.runQuery(fresh, ctx, 'BEGIN')
  for (let i = 0; i < 12; i++) {
    const { rows } = await again()
    assert.deepEqual(rows[0], { db: conn.database, leak: null, auto: 1 })
  }
  mysqlDriver.release(fresh)
})

test('rows go in whole or not at all, in the engine\'s quoting', live, async () => {
  await run('CREATE TABLE `we"ird` (`a b` INT PRIMARY KEY, `c"d` JSON, e VARCHAR(20))')
  assert.deepEqual(await mysqlDriver.insertRow(conn, ctx, { table: 'we"ird', values: { 'a b': 1, 'c"d': { x: [1] }, e: "it's" } }), { ok: true, changes: 1 })
  const row = { 'a b': 2, 'c"d': [1, 2], e: 'back\\slash' }
  assert.deepEqual(await mysqlDriver.insertRows(conn, ctx, { table: 'we"ird', rows: [row, { ...row, 'a b': 3 }] }), { ok: true, inserted: 2 })
  await assert.rejects(mysqlDriver.insertRows(conn, ctx, { table: 'we"ird', rows: [{ ...row, 'a b': 4 }, { ...row, 'a b': 1 }] }), /Duplicate/)
  const { rows } = await run('SELECT `a b` AS a, e, `c"d` AS d FROM `we"ird` ORDER BY 1')
  assert.deepEqual(rows.map((r) => r.a), [1, 2, 3])
  assert.equal(rows[1].e, 'back\\slash')
  assert.deepEqual(rows[1].d, [1, 2])
})

test('a literal survives the trip it was written for', live, async () => {
  const nasty = "\\' OR 1=1 -- \n\t\\\\ %_"
  assert.equal((await run(`SELECT ${mysqlLiteral(nasty)} AS v`)).rows[0].v, nasty)
})

test('a failing script rolls its data statements back', live, async () => {
  await assert.rejects(mysqlDriver.runScript(conn, ctx, "INSERT INTO no_pk VALUES (7, 'q'); INSERT INTO absent VALUES (1);"), /absent/)
  assert.equal((await run('SELECT COUNT(*) AS n FROM no_pk WHERE a = 7')).rows[0].n, 0)
  await mysqlDriver.runScript(conn, ctx, "START TRANSACTION; INSERT INTO no_pk VALUES (8, 'own'); COMMIT;")
  assert.equal((await run('SELECT COUNT(*) AS n FROM no_pk WHERE a = 8')).rows[0].n, 1)
  await run('DELETE FROM no_pk WHERE a = 8')
})

test('table DDL replays', live, async () => {
  const [ddl] = await mysqlDriver.tableDdl(conn, ctx, 'orders')
  assert.match(ddl, /^CREATE TABLE IF NOT EXISTS `orders`/)
  assert.match(ddl, /CONSTRAINT `fk_orders_customer` FOREIGN KEY/)
  await run(ddl) // already there: a no-op, not a failure
  assert.deepEqual(await mysqlDriver.tableDdl(conn, ctx, 'order_totals'), [])
})

test('the analyzer explains without running anything', live, async () => {
  const sql = "SELECT * FROM orders WHERE total > 2 ORDER BY total"
  const report = await mysqlDriver.analyze(conn, ctx, { sql, cls: classifyStatement(sql) })
  assert.equal(report.dialect, 'mysql')
  assert.equal(report.summary.executed, false)
  assert.ok(report.summary.estimatedCost > 0)
  const scan = report.plan.find((p) => p.table === 'orders')
  assert.equal(scan.warning, 'Full table scan with filter')
  assert.ok(report.plan.some((p) => p.step === 'Sort'))
  assert.equal(report.indexSuggestions[0].ddl, 'CREATE INDEX `idx_orders_total` ON `orders` (`total`);')
  await run(report.indexSuggestions[0].ddl)
  const indexed = await mysqlDriver.analyze(conn, ctx, { sql: 'SELECT * FROM orders WHERE id = 1', cls: { kind: 'select', readOnly: true } })
  assert.equal(indexed.plan[0].index, 'PRIMARY')
  await run('DROP INDEX idx_orders_total ON orders')
  const del = await mysqlDriver.analyze(conn, ctx, { sql: 'DELETE FROM no_pk', cls: { kind: 'dml', readOnly: false } })
  assert.equal(del.summary.executed, false)
  assert.equal((await run('SELECT COUNT(*) AS n FROM no_pk')).rows[0].n, 3)
})

test('failures explain themselves', live, async () => {
  const explain = async (config) => {
    const error = await mysqlDriver.testConnection({ ...conn, ...config }).then(() => null, (e) => e)
    assert.ok(error, 'expected the connection to fail')
    return mysqlDriver.explainError(error)?.reason
  }
  assert.equal(await explain({ password: 'wrong' }), 'auth')
  assert.equal(await explain({ database: 'no_such_db' }), 'missing_database')
})

test('it connects with and without TLS, and through a forwarded socket', live, async () => {
  assert.equal((await mysqlDriver.testConnection({ ...conn, sslmode: 'require' })).ok, true)
  await assert.rejects(mysqlDriver.testConnection({ ...conn, sslmode: 'verify-full' }), /self.signed|certificate/i)

  const forward = net.createServer((socket) => socket.pipe(net.connect(Number(url.port), url.hostname)).pipe(socket))
  await new Promise((resolve) => forward.listen(0, '127.0.0.1', resolve))
  const tunneled = { ...conn, id: 'mysql-test-tunnel', host: '127.0.0.1', port: forward.address().port, tunneledHost: url.hostname, sslmode: 'require' }
  assert.equal((await mysqlDriver.ping(tunneled, ctx)).ok, true)
  mysqlDriver.release(tunneled)
  forward.close()
})
