/**
 * Migra para o Vercel Blob os arquivos gravados no formato antigo
 * (`/uploads/<pasta>/x`) — `npm run uploads:migrate`.
 *
 * Por padrão é SIMULAÇÃO: só lista o que encontrou e não altera nada.
 *
 *   npm run uploads:migrate                          # relatório
 *   npm run uploads:migrate -- --apply               # envia para o Blob e atualiza o banco
 *   npm run uploads:migrate -- --apply --remove-missing
 *        # também apaga do banco as imagens de PRODUTO cujo arquivo não existe
 *        # (assim a imagem reenviada no admin vira a principal)
 *   npm run uploads:migrate -- --dir=C:/caminho/uploads   # pasta com os arquivos
 *
 * Os arquivos são procurados em `<dir>/<pasta>/<arquivo>` (padrão: UPLOAD_DIR
 * do .env, ou seja, `backend/uploads`). Quem não tiver o arquivo precisa
 * reenviar a imagem pelo admin.
 *
 * Precisa de DATABASE_URL e, quando houver arquivo para enviar, de
 * BLOB_READ_WRITE_TOKEN. Nunca imprime tokens ou segredos.
 */
// PRIMEIRO import, de propósito: `env` carrega o .env indicado em
// DOTENV_CONFIG_PATH (ex.: .env.production.local). Se o @prisma/client vier
// antes, ele carrega o backend/.env de desenvolvimento e o NODE_ENV/variáveis
// de lá prevalecem (o dotenv não sobrescreve o que já existe).
import { env } from '../src/config/env';
import fs from 'node:fs';
import path from 'node:path';
import { put } from '@vercel/blob';
import { prisma } from '../src/lib/prisma';
import { findLegacyUploads } from './legacy-uploads';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const removeMissing = args.includes('--remove-missing');
const dirArg = args.find((a) => a.startsWith('--dir='))?.slice('--dir='.length);
const baseDir = path.resolve(process.cwd(), dirArg || env.UPLOAD_DIR);

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.stl': 'model/stl',
  '.obj': 'model/obj',
  '.3mf': 'model/3mf',
};

/** `/uploads/products/x.png` → pasta, nome e caminho local esperado. */
function localFileOf(url: string) {
  const [, , folder, filename] = url.split('/');
  return { folder, filename, localPath: path.join(baseDir, folder, filename) };
}

async function main() {
  console.log(`\n${apply ? 'MIGRANDO' : 'SIMULAÇÃO (nada será alterado; use --apply)'} — arquivos em ${baseDir}\n`);
  const refs = await findLegacyUploads();
  if (refs.length === 0) {
    console.log('✔ Nenhuma URL antiga (/uploads/...) no banco. Nada a fazer.\n');
    return;
  }

  if (apply && !env.BLOB_READ_WRITE_TOKEN && refs.some((r) => fs.existsSync(localFileOf(r.url).localPath))) {
    console.error('✖ Há arquivos para enviar e falta BLOB_READ_WRITE_TOKEN (Vercel → Storage → Blob). Nada foi alterado.\n');
    process.exitCode = 1;
    return;
  }

  // A mesma URL pode aparecer em mais de um lugar: envia o arquivo uma vez só.
  const uploaded = new Map<string, string>();
  let migrated = 0;
  let missing = 0;
  let removed = 0;

  for (const ref of refs) {
    const { folder, filename, localPath } = localFileOf(ref.url);

    if (!fs.existsSync(localPath)) {
      missing++;
      if (apply && removeMissing && ref.remove) {
        await ref.remove();
        removed++;
        console.log(`✖ ${ref.where}: arquivo não encontrado — imagem removida do banco (reenvie pelo admin).`);
      } else {
        console.log(`✖ ${ref.where}: arquivo não encontrado (${ref.url}) — reenvie pelo admin.`);
      }
      continue;
    }

    if (!apply) {
      migrated++;
      console.log(`✔ ${ref.where}: arquivo encontrado, será enviado para o Blob.`);
      continue;
    }

    let newUrl = uploaded.get(ref.url);
    if (!newUrl) {
      const blob = await put(`${folder}/${filename}`, fs.readFileSync(localPath), {
        access: 'public',
        contentType: CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? 'application/octet-stream',
        addRandomSuffix: false,
        allowOverwrite: true, // permite rodar de novo sem erro
        token: env.BLOB_READ_WRITE_TOKEN,
      });
      newUrl = blob.url;
      uploaded.set(ref.url, newUrl);
    }
    await ref.update(newUrl);
    migrated++;
    console.log(`✔ ${ref.where}: migrado para o Blob.`);
  }

  console.log(
    `\n${apply ? 'Migrados' : 'Prontos para migrar'}: ${migrated} · Sem arquivo: ${missing}` +
      (removed ? ` (${removed} imagem(ns) de produto removida(s) do banco)` : '') +
      '\n',
  );
  if (missing && !removed) {
    console.log('As que estão sem arquivo precisam ser reenviadas pelo admin. Para imagens de produto,');
    console.log('rode com --apply --remove-missing para tirá-las do banco antes de reenviar.\n');
  }
}

main()
  .catch((e) => {
    console.error('[migrate-uploads] Falha:', (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
