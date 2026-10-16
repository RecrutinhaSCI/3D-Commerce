/**
 * Diagnóstico do Vercel Blob — `npm run check:blob`.
 *
 * Faz o mesmo `put` do upload de produto com um arquivo de teste minúsculo em
 * `diagnostics/` e o apaga em seguida. Não toca em produtos nem no banco.
 * Mostra o erro REAL do SDK (classe + mensagem). Nunca imprime o token.
 *
 * Rodar no Shell do Render (usa as envs do serviço) ou localmente com
 * DOTENV_CONFIG_PATH apontando para um .env com o token de produção.
 */
// PRIMEIRO import: carrega o .env antes de tudo (ver check-config.ts).
import { env } from '../src/config/env';
import crypto from 'node:crypto';
import { put, del } from '@vercel/blob';

async function main() {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error('✗ BLOB_READ_WRITE_TOKEN ausente.');
    process.exit(1);
  }

  console.log(`Token: formato ${token.startsWith('vercel_blob_rw_') ? 'OK (vercel_blob_rw_…)' : 'INESPERADO (não começa com vercel_blob_rw_)'}, ${token.length} caracteres.`);
  const storeId = token.split('_')[3];
  if (storeId) console.log(`Store id (do token): ${storeId}`);

  const pathname = `diagnostics/healthcheck-${crypto.randomBytes(6).toString('hex')}.txt`;
  let url: string | undefined;
  try {
    const blob = await put(pathname, Buffer.from('ok'), {
      access: 'public',
      contentType: 'text/plain',
      addRandomSuffix: false,
      token,
    });
    url = blob.url;
    console.log(`✓ put OK → ${blob.url}`);
  } catch (err) {
    const reason = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
    console.error(`✗ put FALHOU — ${reason}`);
    process.exit(1);
  }

  try {
    await del(url, { token });
    console.log('✓ del OK (arquivo de teste removido).');
  } catch (err) {
    const reason = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
    console.error(`! del falhou (arquivo de teste ficou em ${pathname}) — ${reason}`);
  }
}

void main();
