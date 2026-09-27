import pg from 'pg';

const { Pool } = pg;

function convertPlaceholders(sql) {
  let out = '';
  let index = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          out += sql[++i];
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '?') {
      index += 1;
      out += `$${index}`;
      continue;
    }
    out += ch;
  }
  return out.replace(/datetime\(([^)]+)\)/gi, '$1');
}

class PgStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }
  bind(...params) {
    this.params = params;
    return this;
  }
  query() {
    return { text: convertPlaceholders(this.sql), values: this.params };
  }
  async first() {
    const q = this.query();
    const result = await this.db.pool.query(q.text, q.values);
    return result.rows[0] ?? null;
  }
  async all() {
    const q = this.query();
    const result = await this.db.pool.query(q.text, q.values);
    return { results: result.rows };
  }
  async run() {
    const q = this.query();
    const result = await this.db.pool.query(q.text, q.values);
    return { success: true, meta: { changes: result.rowCount ?? 0 } };
  }
}

export class PgD1Adapter {
  constructor(connectionString, options = {}) {
    if (!connectionString) throw new Error('DATABASE_URL is required.');
    this.pool = new Pool({
      connectionString,
      ssl: options.ssl === false ? false : (connectionString.includes('localhost') ? false : { rejectUnauthorized: false }),
      max: Number(options.max || 8),
      idleTimeoutMillis: 30_000,
    });
  }
  prepare(sql) {
    return new PgStatement(this, sql);
  }
  async batch(statements) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const results = [];
      for (const statement of statements) {
        const q = statement.query();
        const result = await client.query(q.text, q.values);
        results.push({ success: true, meta: { changes: result.rowCount ?? 0 }, results: result.rows });
      }
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}