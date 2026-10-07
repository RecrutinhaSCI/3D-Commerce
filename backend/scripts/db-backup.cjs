/**
 * Backup completo dos DADOS do banco (todas as tabelas do schema public),
 * sem depender de pg_dump. Gera:
 *   - <nome>.json  → { meta, tables: { tabela: [linhas...] } }
 *   - <nome>.sql   → INSERTs restauráveis (tipos preservados via json_populate_record)
 *
 * Uso (na pasta backend):  node scripts/db-backup.cjs [pastaDestino]
 *
 * Restauração (num banco com o schema já migrado e tabelas vazias):
 *   psql "$DATABASE_URL" -f <nome>.sql
 * As tabelas saem em ordem topológica das FKs (pais antes de filhos), então
 * a carga funciona sem privilégio de superusuário (Neon não permite
 * session_replication_role).
 *
 * ATENÇÃO: o arquivo contém hash de senha do admin e dados de clientes.
 * Nunca versionar — a pasta backups/ está no .gitignore.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'backups'));
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(outDir, `3dcommerce-backup-${stamp}`);

  const tables = await tablesInFkOrder();

  const json = { meta: { createdAt: new Date().toISOString(), host: hostOf(process.env.DATABASE_URL), counts: {} }, tables: {} };
  const sql = [
    `-- 3DCommerce backup ${json.meta.createdAt} (host ${json.meta.host})`,
    `-- Restaurar num banco com o schema migrado e tabelas vazias.`,
    `BEGIN;`,
  ];

  for (const t of tables) {
    // Linhas como JSON (para o .json) e INSERT pronto (para o .sql) — os dois
    // vêm da MESMA consulta para garantir consistência.
    const rows = await prisma.$queryRawUnsafe(
      `select row_to_json(x)::text as j,
              format('INSERT INTO public.%I SELECT * FROM json_populate_record(null::public.%I, %L);', $1::text, $1::text, row_to_json(x)::text) as ins
         from public."${t}" x`,
      t,
    );
    json.tables[t] = rows.map((r) => JSON.parse(r.j));
    json.meta.counts[t] = rows.length;
    sql.push(`-- ${t}: ${rows.length} linha(s)`);
    for (const r of rows) sql.push(r.ins);
  }
  sql.push(`COMMIT;`);

  fs.writeFileSync(`${base}.json`, JSON.stringify(json, null, 1));
  fs.writeFileSync(`${base}.sql`, sql.join('\n') + '\n');

  for (const ext of ['json', 'sql']) {
    const f = `${base}.${ext}`;
    const buf = fs.readFileSync(f);
    console.log(`${f}\n  bytes=${buf.length} sha256=${crypto.createHash('sha256').update(buf).digest('hex')}`);
  }
  console.log('counts', json.meta.counts);
}

/** Ordena tabelas para que toda tabela referenciada venha antes de quem a referencia. */
async function tablesInFkOrder() {
  const all = (
    await prisma.$queryRawUnsafe(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
    )
  ).map((r) => r.table_name);
  const edges = await prisma.$queryRawUnsafe(
    `select distinct tc.table_name as child, ccu.table_name as parent
       from information_schema.table_constraints tc
       join information_schema.constraint_column_usage ccu
         on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`,
  );
  const parents = new Map(all.map((t) => [t, new Set()]));
  for (const e of edges) if (e.child !== e.parent) parents.get(e.child)?.add(e.parent);
  const ordered = [];
  const done = new Set();
  while (ordered.length < all.length) {
    const next = all.find((t) => !done.has(t) && [...parents.get(t)].every((p) => done.has(p)));
    if (!next) throw new Error('Ciclo de FK detectado — ordem de restauração indefinida.');
    ordered.push(next);
    done.add(next);
  }
  return ordered;
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return 'desconhecido'; }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
