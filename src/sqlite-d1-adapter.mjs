import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

class SqliteStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  statement() {
    return this.db.prepare(this.sql);
  }

  async first() {
    const row = this.statement().get(...this.params);
    return row ?? null;
  }

  async all() {
    return { results: this.statement().all(...this.params) };
  }

  async run() {
    const result = this.statement().run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes || 0),
        last_row_id: result.lastInsertRowid == null ? null : Number(result.lastInsertRowid)
      }
    };
  }
}

export class SqliteD1Adapter {
  constructor(filePath) {
    this.filePath = resolve(filePath);
    this.db = new DatabaseSync(this.filePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  static async open(filePath) {
    const absolute = resolve(filePath);
    await mkdir(dirname(absolute), { recursive: true });
    return new SqliteD1Adapter(absolute);
  }

  async migrate(sqlFile) {
    const sql = await readFile(sqlFile, 'utf8');
    this.db.exec(sql);
  }

  prepare(sql) {
    return new SqliteStatement(this.db, sql);
  }

  async batch(statements) {
    this.db.exec('BEGIN IMMEDIATE;');
    const results = [];
    try {
      for (const statement of statements) {
        const prepared = statement.statement();
        const text = statement.sql.trim().toLowerCase();
        if (text.startsWith('select') || text.startsWith('with')) {
          const rows = prepared.all(...statement.params);
          results.push({ success: true, meta: { changes: 0 }, results: rows });
        } else {
          const result = prepared.run(...statement.params);
          results.push({
            success: true,
            meta: {
              changes: Number(result.changes || 0),
              last_row_id: result.lastInsertRowid == null ? null : Number(result.lastInsertRowid)
            },
            results: []
          });
        }
      }
      this.db.exec('COMMIT;');
      return results;
    } catch (error) {
      try { this.db.exec('ROLLBACK;'); } catch (_) {}
      throw error;
    }
  }

  async close() {
    this.db.close();
  }
}