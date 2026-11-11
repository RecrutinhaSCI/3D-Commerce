/** PostgreSQL real, isolado em schema descartável num banco LOCAL *_test. */
import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { dbEnabled, TEST_URL } from '../shipping/labels/labels.dbHarness.testdata';

const exec = promisify(execFile);
const psql = process.env.PSQL_PATH ?? (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin/psql.exe' : 'psql');
const migration = readFileSync(path.resolve(__dirname, '../../..', 'prisma/migrations/20261111130000_order_public_code/migration.sql'), 'utf8');
let schema = '';
function url() {
  const parsed = new URL(TEST_URL!);
  parsed.search = '';
  return parsed.toString();
}
async function sql(query: string, withSchema = true) {
  const { stdout } = await exec(psql, [url(), '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', `${withSchema ? `SET search_path TO "${schema}";` : ''}${query}`]);
  return stdout.trim();
}
async function baseline(rows = '') {
  schema = `order_code_test_${process.pid}_${Math.random().toString(16).slice(2)}`;
  await sql(`CREATE SCHEMA "${schema}";`, false);
  await sql(`CREATE TABLE orders (id text PRIMARY KEY, created_at timestamptz NOT NULL, external_reference text, notes text);
    CREATE TABLE order_items (id text PRIMARY KEY, order_id text REFERENCES orders(id)); ${rows}`);
}

describe.skipIf(!dbEnabled)('numeração pública — migration e concorrência PostgreSQL', () => {
  afterEach(async () => {
    if (schema) await sql(`DROP SCHEMA "${schema}" CASCADE;`, false);
    schema = '';
  });
  it('backfill cronológico com desempate por id; preserva dados/FKs e continua no próximo código', async () => {
    await baseline(`INSERT INTO orders VALUES ('z', '2026-01-02', 'mp-z', 'nota z'), ('b', '2026-01-01', 'mp-b', 'nota b'), ('a', '2026-01-01', 'mp-a', 'nota a');
      INSERT INTO order_items VALUES ('item-a', 'a');`);
    const before = await sql(`SELECT json_agg(o ORDER BY id)::text FROM orders o;`);
    await sql(migration);
    expect(JSON.parse(await sql(`SELECT json_agg(json_build_object('id',id,'publicCode',public_code) ORDER BY created_at,id)::text FROM orders;`))).toEqual([
      { id: 'a', publicCode: '3DCOMMERCE00001' }, { id: 'b', publicCode: '3DCOMMERCE00002' }, { id: 'z', publicCode: '3DCOMMERCE00003' },
    ]);
    expect(JSON.parse(await sql(`SELECT json_agg(to_jsonb(o)-'public_code' ORDER BY id)::text FROM orders o;`))).toEqual(JSON.parse(before));
    expect(await sql(`SELECT order_id FROM order_items WHERE id='item-a';`)).toBe('a');
    expect(await sql(`INSERT INTO orders(id,created_at) VALUES ('new',now()) RETURNING public_code;`)).toBe('3DCOMMERCE00004');
    await expect(sql(`INSERT INTO orders(id,created_at,public_code) VALUES ('duplicate',now(),'3DCOMMERCE00001');`)).rejects.toThrow();
  });
  it('cópia com histórico completo mantém pedidos, itens, pagamentos e etiquetas integralmente', async () => {
    schema = `order_code_copy_test_${process.pid}_${Math.random().toString(16).slice(2)}`;
    await sql(`CREATE SCHEMA "${schema}";`, false);
    const runFile = (file: string) => exec(psql, [url(), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO "${schema}";`, '-f', file]);
    const folder = path.resolve(__dirname, '../../..', 'prisma/migrations');
    const prior = readdirSync(folder).filter((name) => name < '20261111130000_order_public_code' && /^\d/.test(name)).sort();
    for (const name of prior) await runFile(path.join(folder, name, 'migration.sql'));
    // Full JSON snapshots include every existing column and all provider references/FKs.
    await runFile(path.join(__dirname, 'orderPublicCode.fixture.testdata.sql'));
    await sql(migration);
    await runFile(path.join(__dirname, 'orderPublicCode.assertions.testdata.sql'));
  }, 40000);

  it('base vazia começa em 1; 32 criações concorrentes recebem códigos únicos/sequenciais', async () => {
    await baseline(); await sql(migration);
    const codes = await Promise.all(Array.from({ length: 32 }, (_, i) => sql(`INSERT INTO orders(id,created_at) VALUES ('parallel-${i}',now()) RETURNING public_code;`)));
    expect(new Set(codes).size).toBe(32);
    expect(codes.sort()).toEqual(Array.from({ length: 32 }, (_, i) => `3DCOMMERCE${String(i + 1).padStart(5, '0')}`));
  }, 20000);
  it('não trunca acima de 99999 e não reutiliza código de transação revertida', async () => {
    await baseline(); await sql(migration);
    await sql(`SELECT setval('order_public_number_seq',99999,true);`);
    expect(await sql(`INSERT INTO orders(id,created_at) VALUES ('large',now()) RETURNING public_code;`)).toBe('3DCOMMERCE100000');
    await sql(`BEGIN; INSERT INTO orders(id,created_at) VALUES ('rollback',now()); ROLLBACK;`);
    expect(await sql(`INSERT INTO orders(id,created_at) VALUES ('after-rollback',now()) RETURNING public_code;`)).toBe('3DCOMMERCE100002');
    expect(await sql(`SELECT count(*) FROM orders WHERE id='rollback';`)).toBe('0');
  });
  it('erro na migration reverte adição da coluna e da sequence atomicamente', async () => {
    await baseline();
    await sql(`CREATE FUNCTION next_order_public_code() RETURNS text LANGUAGE sql AS $$ SELECT 'existing'::text $$;`);
    await expect(sql(migration)).rejects.toThrow();
    expect(await sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='orders' AND column_name='public_code';`)).toBe('0');
    expect(await sql(`SELECT to_regclass('order_public_number_seq') IS NULL;`)).toBe('t');
  });
});
