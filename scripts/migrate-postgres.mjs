import { readFile } from 'node:fs/promises';
import pg from 'pg';
const { Client } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const sql = await readFile(new URL('../migrations/001_postgres_v22.sql', import.meta.url), 'utf8');
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } });
await client.connect();
try { await client.query(sql); console.log('Scout Lab Postgres migration applied.'); }
finally { await client.end(); }