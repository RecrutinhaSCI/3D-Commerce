/**
 * Auditoria SOMENTE LEITURA de todas as URLs de imagem/arquivo do banco —
 * `npm run uploads:audit`. Não altera banco nem Blob.
 *
 *   npm run uploads:audit                       # resumo + lista de problemas
 *   npm run uploads:audit -- --base=https://api.exemplo.com
 *        # testa também por HTTP as URLs relativas (/uploads/...) nesse host
 *   npm run uploads:audit -- --json=relatorio.json   # salva o detalhe em JSON
 *
 * Para cada referência informa: origem (blob, uploads, seed, externa), se o
 * arquivo ainda existe no disco local (UPLOAD_DIR) — o que decide se dá para
 * migrar automaticamente — e o status HTTP. Produto ativo/inativo é indicado.
 *
 * Rodar no Shell do Render dá a resposta definitiva sobre o disco de lá.
 */
// PRIMEIRO import: carrega o .env antes do Prisma (ver migrate-uploads.ts).
import { env } from '../src/config/env';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { legacyUploadPath } from './legacy-uploads';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('--base='))?.slice('--base='.length).replace(/\/$/, '');
const jsonOut = args.find((a) => a.startsWith('--json='))?.slice('--json='.length);
const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR);

type Origin = 'blob' | 'uploads' | 'seed' | 'externa' | 'data' | 'outra';
type Ref = { entity: string; where: string; active?: boolean; url: string; origin?: Origin; localFile?: boolean; http?: string };

const originOf = (u: string): Origin =>
  u.includes('.blob.vercel-storage.com/') ? 'blob'
  : u.startsWith('/uploads/seed/') ? 'seed'
  : legacyUploadPath(u) ? 'uploads'
  : u.startsWith('data:') ? 'data'
  : /^https?:\/\//i.test(u) ? 'externa'
  : 'outra';

function collectStrings(value: unknown, at: string, out: Array<{ at: string; url: string }>) {
  if (typeof value === 'string') {
    if (/^(\/uploads\/|https?:\/\/)/i.test(value) && /\.(png|jpe?g|webp|gif|avif|svg|mp4)(\?|$)|\/uploads\/|blob\.vercel-storage\.com/i.test(value)) {
      out.push({ at, url: value });
    }
  } else if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => collectStrings(v, `${at}.${k}`, out));
}

async function probe(url: string): Promise<string> {
  const target = url.startsWith('/') ? (base ? base + url : null) : url;
  if (!target) return '-';
  try {
    const res = await fetch(target, { method: 'GET', signal: AbortSignal.timeout(20000) });
    const ct = res.headers.get('content-type') ?? '';
    await res.body?.cancel();
    if (res.ok && /text\/html|application\/json/.test(ct)) return `${res.status} (não é arquivo: ${ct.split(';')[0]})`;
    return String(res.status);
  } catch (err) {
    return `erro: ${(err as Error).message}`;
  }
}

async function main() {
  const refs: Ref[] = [];

  const images = await prisma.productImage.findMany({
    select: { url: true, position: true, product: { select: { name: true, active: true } } },
    orderBy: [{ productId: 'asc' }, { position: 'asc' }],
  });
  for (const i of images) {
    refs.push({ entity: 'Produto', where: `"${i.product.name}" (pos ${i.position})`, active: i.product.active, url: i.url });
  }
  const noImage = await prisma.product.findMany({ where: { images: { none: {} } }, select: { name: true, active: true } });

  for (const c of await prisma.category.findMany({ where: { seasonalBannerImage: { not: null } } })) {
    refs.push({ entity: 'Categoria', where: `"${c.name}" (banner sazonal)`, active: c.active, url: c.seasonalBannerImage! });
  }
  for (const b of await prisma.banner.findMany({ where: { imageUrl: { not: null } } })) {
    refs.push({ entity: 'Banner', where: `"${b.title}"`, active: b.active, url: b.imageUrl! });
  }
  for (const t of await prisma.testimonial.findMany({ where: { avatarUrl: { not: null } } })) {
    refs.push({ entity: 'Depoimento', where: `"${t.name}"`, url: t.avatarUrl! });
  }
  for (const f of await prisma.quoteFile.findMany({ select: { url: true, originalName: true } })) {
    refs.push({ entity: 'Orçamento', where: `"${f.originalName}"`, url: f.url });
  }
  const settings = await prisma.siteSettings.findUnique({ where: { id: 'main' } });
  if (settings) {
    const found: Array<{ at: string; url: string }> = [];
    for (const [field, value] of Object.entries(settings)) collectStrings(value, field, found);
    for (const f of found) refs.push({ entity: 'Configurações', where: f.at, url: f.url });
  }

  // Classifica + checa disco local e HTTP (uma vez por URL).
  const httpCache = new Map<string, string>();
  for (const r of refs) {
    r.origin = originOf(r.url);
    const legacy = legacyUploadPath(r.url);
    if (legacy) r.localFile = fs.existsSync(path.join(uploadDir, ...legacy.split('/').slice(2)));
    if (r.origin === 'data' || r.origin === 'outra') continue;
    if (!httpCache.has(r.url)) httpCache.set(r.url, await probe(r.url));
    r.http = httpCache.get(r.url);
  }

  const ok = (r: Ref) => r.http === '200' || r.origin === 'seed';
  const broken = (r: Ref) => r.http !== undefined && r.http !== '-' && !ok(r);

  console.log(`\nAUDITORIA DE IMAGENS (somente leitura) — disco local: ${uploadDir}${base ? ` · HTTP base: ${base}` : ''}\n`);
  const table: Record<string, Record<string, number>> = {};
  for (const r of refs) {
    const row = (table[`${r.entity} · ${r.origin}`] ??= { total: 0, ativos: 0, inativos: 0, ok: 0, quebradas: 0, 'arquivo local': 0 });
    row.total++;
    if (r.active === true) row.ativos++;
    if (r.active === false) row.inativos++;
    if (ok(r)) row.ok++;
    if (broken(r)) row.quebradas++;
    if (r.localFile) row['arquivo local']++;
  }
  console.table(table);

  const legacy = refs.filter((r) => r.origin === 'uploads');
  const migratable = legacy.filter((r) => r.localFile);
  const manual = legacy.filter((r) => !r.localFile);
  const counts = new Map<string, number>();
  refs.forEach((r) => counts.set(r.url, (counts.get(r.url) ?? 0) + 1));
  const dups = [...counts].filter(([, n]) => n > 1);

  console.log(`Total de referências: ${refs.length}`);
  console.log(`  no Blob: ${refs.filter((r) => r.origin === 'blob').length}`);
  console.log(`  /uploads (relativa ou absoluta): ${legacy.length} — migráveis automaticamente (arquivo existe): ${migratable.length} · exigem reupload: ${manual.length}`);
  console.log(`  externas: ${refs.filter((r) => r.origin === 'externa').length} · seed: ${refs.filter((r) => r.origin === 'seed').length}`);
  console.log(`  quebradas (HTTP): ${refs.filter(broken).length}`);
  console.log(`  URLs duplicadas: ${dups.length}`);
  console.log(`Produtos sem nenhuma imagem: ${noImage.length} (ativos: ${noImage.filter((p) => p.active).length})\n`);

  const problems = refs.filter((r) => broken(r) || (r.origin === 'uploads' && !r.localFile));
  if (problems.length) {
    console.log('Problemas:');
    for (const r of problems) {
      const st = r.active === undefined ? '' : r.active ? ' [ativo]' : ' [inativo]';
      console.log(`  ✖ ${r.entity}${st} ${r.where} — ${r.origin}${r.origin === 'uploads' ? (r.localFile ? ', arquivo local OK' : ', SEM arquivo') : ''} — HTTP ${r.http ?? '-'} → ${r.url}`);
    }
    console.log('');
  }
  for (const [url, n] of dups) console.log(`  ↺ ${n}x ${url}`);

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({ refs, noImage, duplicates: dups }, null, 2));
    console.log(`Detalhe salvo em ${jsonOut}\n`);
  }
}

main()
  .catch((e) => {
    console.error('[audit-images] Falha:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
