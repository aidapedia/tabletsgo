import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { mariadbDriver, mysqlDriver, quoteIdent } from '../server/db/mysql.js'
import { classifyStatement } from '../server/db/sql.js'
import { moduleById } from '../server/module-registry.js'

// MariaDB runs on the MySQL driver's code (server/db/mysql.js); this suite holds
// it to what a MariaDB server actually answers. The pure half runs everywhere;
// the rest talks to a real server, so it needs
//   MARIADB_TEST_URL=mysql://root:secret@127.0.0.1:3306/scratch npm test
// and it owns that database: it drops and recreates its tables.
const url = process.env.MARIADB_TEST_URL ? new URL(process.env.MARIADB_TEST_URL) : null
const conn = url && {
  id: 'mariadb-test',
  type: 'mariadb',
  host: url.hostname,
  port: url.port,
  username: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
}
const ctx = {}
const live = { skip: url ? false : 'set MARIADB_TEST_URL to run' }

const run = async (sql) => {
  const r = await mariadbDriver.runQuery(conn, ctx, sql)
  assert.equal(r.error, undefined, r.error)
  return r
}

test('MariaDB is its own engine and module, on the MySQL implementation', () => {
  assert.equal(mariadbDriver.type, 'mariadb')
  assert.equal(mariadbDriver.label, 'MariaDB')
  assert.equal(mariadbDriver.defaultPort, 3306)
  assert.equal(typeof mariadbDriver.dump, 'function') // so the backup schedule applies
  assert.deepEqual(Object.keys(mariadbDriver).sort(), Object.keys(mysqlDriver).sort())
  assert.equal(moduleById('mariadb')?.kind, 'engine')
})

before(async () => {
  if (!url) return
  const { rows: leftovers } = await run(
    `SELECT TABLE_NAME AS name, TABLE_TYPE AS kind FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`
  )
  const kindOf = { VIEW: 'VIEW', SEQUENCE: 'SEQUENCE' }
  const drops = leftovers.map((t) => `DROP ${kindOf[t.kind] || 'TABLE'} IF EXISTS ${quoteIdent(t.name)};`)
  await mariadbDriver.runScript(conn, ctx, `
    SET FOREIGN_KEY_CHECKS = 0;
    ${drops.join('\n    ')}
    DROP FUNCTION IF EXISTS add_tax;
    SET FOREIGN_KEY_CHECKS = 1;
    CREATE TABLE customers (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(190) NOT NULL UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'lifecycle',
      quirky VARCHAR(20) DEFAULT 'it''s a\\\\b',
      word VARCHAR(5) DEFAULT 'NULL',
      bio TEXT,
      score DECIMAL(10,2) DEFAULT 1.50,
      flags BIT(8) DEFAULT b'101',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      token CHAR(36) DEFAULT (UUID()),
      KEY idx_status (status),
      KEY idx_bio (bio(16)),
      FULLTEXT KEY ft_bio (bio)
    );
    CREATE TABLE orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customer_id BIGINT UNSIGNED NOT NULL,
      total DECIMAL(10,2) NOT NULL,
      CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
    );
    CREATE TABLE no_pk (a INT, b VARCHAR(10));
    CREATE TABLE audit (id INT PRIMARY KEY, v INT) WITH SYSTEM VERSIONING;
    CREATE SEQUENCE ticket_seq;
    CREATE VIEW order_totals AS SELECT customer_id, SUM(total) AS spent FROM orders GROUP BY customer_id;
    CREATE FUNCTION add_tax(amount DECIMAL(10,2)) RETURNS DECIMAL(10,2) DETERMINISTIC RETURN amount * 1.1;
    INSERT INTO customers (email, bio) VALUES ('a@x.io', 'hello'), ('b@x.io', NULL);
    INSERT INTO orders (customer_id, total) VALUES (1, 10.00), (1, 5.50), (2, 1.25);
    INSERT INTO no_pk VALUES (1, 'x'), (1, 'x'), (2, 'y');
  `)
})

after(() => {
  if (url) mariadbDriver.closeAll()
})

test('it names itself MariaDB and reads the version', live, async () => {
  assert.match(await mariadbDriver.serverVersion(conn, ctx), /^\d+\.\d+/)
  assert.deepEqual(await mariadbDriver.testConnection(conn), { ok: true, message: `Connected to MariaDB (${conn.database})!` })
  const ns = await mariadbDriver.namespaces(conn, ctx)
  assert.equal(ns.currentDatabase, conn.database)
  assert.deepEqual(ns.schemas, [])
})

test('system-versioned tables are tables; sequences stay out of the lists', live, async () => {
  const tables = await mariadbDriver.listTables(conn, ctx)
  assert.ok(tables.includes('audit'))
  assert.ok(!tables.includes('ticket_seq'))
  assert.ok(!tables.includes('order_totals'))
  const objects = await mariadbDriver.listObjects(conn, ctx)
  assert.ok(objects.some((o) => o.name === 'audit' && o.type === 'table'))
  assert.ok(objects.some((o) => o.name === 'order_totals' && o.type === 'view'))
  assert.ok(objects.some((o) => o.name === 'add_tax' && o.type === 'function' && /amount decimal/i.test(o.detail)))
  assert.ok(!objects.some((o) => o.name === 'ticket_seq'))
  assert.ok((await mariadbDriver.getDiagram(conn, ctx)).tables.some((t) => t.name === 'audit'))
})

// MariaDB's COLUMN_DEFAULT is already SQL; MySQL's is the bare value. Re-quoting
// MariaDB's would turn 'active' into '''active''' in every ALTER the designer writes.
const expectDefaults = (cols) => {
  assert.equal(cols.id.default, null)
  assert.equal(cols.email.default, null)
  assert.equal(cols.status.default, "'active'")
  assert.equal(cols.status.extra, "COMMENT 'lifecycle'")
  assert.equal(cols.word.default, "'NULL'") // the string, not DEFAULT NULL
  assert.equal(cols.bio.default, null) // DEFAULT NULL reads as the bare word
  assert.equal(cols.score.default, '1.50')
  assert.equal(cols.flags.default, "b'101'")
  assert.match(cols.created_at.default, /^current_timestamp(\(\))?$/i)
  assert.match(cols.created_at.extra, /^ON UPDATE current_timestamp(\(\))?$/i)
  assert.match(cols.token.default, /^\(?uuid\(\)\)?$/i)
}

test('columns come back ready for DDL', live, async () => {
  const cols = Object.fromEntries((await mariadbDriver.getColumns(conn, ctx, 'customers')).map((c) => [c.name, c]))
  assert.match(cols.id.type, /^bigint(\(20\))? unsigned$/)
  assert.equal(cols.id.pk, true)
  assert.equal(cols.id.extra, 'AUTO_INCREMENT')
  expectDefaults(cols)
  const [, fk] = await mariadbDriver.getColumns(conn, ctx, 'orders')
  assert.deepEqual(fk.references, { table: 'customers', column: 'id' })
})

test('a default replays: restating every column with its own default changes nothing', live, async () => {
  const before = await mariadbDriver.getColumns(conn, ctx, 'customers')
  const restate = before
    .filter((c) => !c.pk)
    .map((c) => `MODIFY COLUMN ${quoteIdent(c.name)} ${c.type}${c.notnull ? ' NOT NULL' : ''}${c.default !== null ? ` DEFAULT ${c.default}` : ''}${c.extra ? ` ${c.extra}` : ''}`)
  await run(`ALTER TABLE customers ${restate.join(', ')}`)
  assert.deepEqual(await mariadbDriver.getColumns(conn, ctx, 'customers'), before)
  const { rows } = await run("INSERT INTO customers (email) VALUES ('c@x.io'); SELECT quirky, word, status FROM customers WHERE email = 'c@x.io'")
  assert.deepEqual(rows[0], { quirky: "it's a\\b", word: 'NULL', status: 'active' })
  await run("DELETE FROM customers WHERE email = 'c@x.io'")
})

test('a MariaDB server added as "MySQL" reads its defaults the same way', live, async () => {
  const asMysql = { ...conn, id: 'mariadb-test-as-mysql', type: 'mysql' }
  expectDefaults(Object.fromEntries((await mysqlDriver.getColumns(asMysql, ctx, 'customers')).map((c) => [c.name, c])))
  mysqlDriver.release(asMysql)
})

test('indexes: plain ones are editable, prefix and FULLTEXT say why not', live, async () => {
  const idx = Object.fromEntries((await mariadbDriver.getIndexes(conn, ctx, 'customers')).map((i) => [i.name, i]))
  assert.equal(idx.PRIMARY.primary, true)
  assert.equal(idx.email.unique, true)
  assert.equal(idx.idx_status.locked, undefined)
  assert.equal(idx.idx_bio.locked, 'prefix')
  assert.equal(idx.idx_bio.columns, 'bio(16)')
  assert.equal(idx.ft_bio.locked, 'fulltext')
})

test('the diagram names foreign keys', live, async () => {
  const { foreignKeys } = await mariadbDriver.getDiagram(conn, ctx)
  assert.deepEqual(foreignKeys, [
    { constraint: 'fk_orders_customer', table: 'orders', column: 'customer_id', refTable: 'customers', refColumn: 'id', onDelete: 'CASCADE', onUpdate: 'RESTRICT' },
  ])
})

test('data, results and literals behave as on MySQL', live, async () => {
  const page = await mariadbDriver.getTableData(conn, ctx, { table: 'orders', limit: 2, offset: 1 })
  assert.deepEqual(page.rows.map((r) => r.id), [2, 3])
  assert.equal(page.rows[0].total, '5.50')
  assert.equal((await run('SELECT flags FROM customers WHERE id = 1')).rows[0].flags, '5')
  assert.deepEqual(await run('SELECT 1 + 1 AS two'), { type: 'rows', columns: ['two'], rows: [{ two: 2 }] })
  const nasty = "\\' OR 1=1 -- \n\t\\\\ %_"
  assert.equal((await run(`SELECT ${mariadbDriver.sqlLiteral(nasty)} AS v`)).rows[0].v, nasty)
  assert.deepEqual(await mariadbDriver.insertRows(conn, ctx, { table: 'no_pk', rows: [{ a: 9, b: 'back\\slash' }] }), { ok: true, inserted: 1 })
  assert.equal((await run('SELECT b FROM no_pk WHERE a = 9')).rows[0].b, 'back\\slash')
  await run('DELETE FROM no_pk WHERE a = 9')
  const [ddl] = await mariadbDriver.tableDdl(conn, ctx, 'orders')
  assert.match(ddl, /^CREATE TABLE IF NOT EXISTS `orders`/)
  await run(ddl)
})

test('the analyzer reads MariaDB\'s plan and suggests the index', live, async () => {
  const sql = 'SELECT * FROM orders WHERE total > 2 ORDER BY total'
  const report = await mariadbDriver.analyze(conn, ctx, { sql, cls: classifyStatement(sql) })
  assert.equal(report.summary.executed, false)
  assert.ok(report.summary.estimatedCost > 0)
  const scan = report.plan.find((p) => p.table === 'orders')
  assert.equal(scan.warning, 'Full table scan with filter')
  assert.equal(scan.rows, 3)
  assert.ok(report.plan.some((p) => p.step === 'Sort'))
  assert.equal(report.indexSuggestions[0].ddl, 'CREATE INDEX `idx_orders_total` ON `orders` (`total`);')
  // MariaDB writes the condition with bare names (orders.total > 2), not backticks.
  const filtered = await mariadbDriver.analyze(conn, ctx, { sql: 'SELECT * FROM orders WHERE total > 2', cls: { kind: 'select', readOnly: true } })
  assert.equal(filtered.indexSuggestions[0]?.ddl, 'CREATE INDEX `idx_orders_total` ON `orders` (`total`);')
  assert.match(JSON.stringify(filtered.indexSuggestions[0]), /let MariaDB look the rows up/)
  const indexed = await mariadbDriver.analyze(conn, ctx, { sql: 'SELECT * FROM orders WHERE id = 1', cls: { kind: 'select', readOnly: true } })
  assert.equal(indexed.plan[0].index, 'PRIMARY')
})

test('failures explain themselves', live, async () => {
  const explain = async (config) => {
    const error = await mariadbDriver.testConnection({ ...conn, ...config }).then(() => null, (e) => e)
    assert.ok(error, 'expected the connection to fail')
    return mariadbDriver.explainError(error)
  }
  const auth = await explain({ password: 'wrong' })
  assert.equal(auth.reason, 'auth')
  assert.match(auth.cause, /^MariaDB rejected/)
  assert.equal((await explain({ database: 'no_such_db' })).reason, 'missing_database')
})

test('it connects through a forwarded socket', live, async () => {
  const forward = net.createServer((socket) => socket.pipe(net.connect(Number(url.port), url.hostname)).pipe(socket))
  await new Promise((resolve) => forward.listen(0, '127.0.0.1', resolve))
  const tunneled = { ...conn, id: 'mariadb-test-tunnel', host: '127.0.0.1', port: forward.address().port, tunneledHost: url.hostname }
  assert.equal((await mariadbDriver.ping(tunneled, ctx)).ok, true)
  mariadbDriver.release(tunneled)
  forward.close()
})
