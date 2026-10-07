import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { put, del } from '@vercel/blob';
import type { Request } from 'express';
import { env } from '../config/env';
import { HttpError } from '../utils/httpError';

/**
 * Armazenamento de uploads (produtos, orçamentos, site).
 *
 * - **Produção (Vercel):** com `BLOB_READ_WRITE_TOKEN` os arquivos vão para o
 *   **Vercel Blob** e o banco guarda a URL pública absoluta do Blob. As funções
 *   da Vercel não têm disco gravável — por isso nada é escrito localmente.
 * - **Desenvolvimento:** sem o token, grava em `UPLOAD_DIR/<pasta>` e serve por
 *   `/uploads/<pasta>/<arquivo>` (express.static no app.ts), como antes.
 *
 * Os controllers usam `storedFileUrl(file)` para obter a URL a persistir e as
 * funções `safeUnlink*` aceitam tanto URL do Blob quanto caminho local.
 */

type Folder = 'products' | 'quotes' | 'site';

export const isBlobStorage = (): boolean => Boolean(env.BLOB_READ_WRITE_TOKEN);

const localDir = (folder: Folder) => path.resolve(process.cwd(), env.UPLOAD_DIR, folder);

/** Nome imprevisível: 32 hex + extensão já validada pelo fileFilter. */
function randomName(ext: string): string {
  return `${crypto.randomBytes(16).toString('hex')}${ext}`;
}

/**
 * StorageEngine do multer que grava no Blob ou no disco. Após o upload,
 * `file.filename` = nome gerado e `file.path` = URL do Blob ou caminho local.
 */
function createStorage(folder: Folder, extFor: (file: Express.Multer.File) => string): multer.StorageEngine {
  return {
    _handleFile(_req, file, cb) {
      const filename = randomName(extFor(file));
      if (isBlobStorage()) {
        const chunks: Buffer[] = [];
        file.stream.on('data', (c: Buffer) => chunks.push(c));
        file.stream.on('error', cb);
        file.stream.on('end', async () => {
          try {
            const body = Buffer.concat(chunks);
            const blob = await put(`${folder}/${filename}`, body, {
              access: 'public',
              contentType: file.mimetype,
              addRandomSuffix: false,
              token: env.BLOB_READ_WRITE_TOKEN,
            });
            cb(null, { filename, path: blob.url, size: body.length });
          } catch {
            // eslint-disable-next-line no-console
            console.error(`[upload] Falha ao enviar ${folder}/${filename} para o Vercel Blob.`);
            cb(HttpError.internal('Falha ao salvar o arquivo. Tente novamente.'));
          }
        });
        return;
      }

      // Disco (dev). Diretório criado sob demanda — nunca no import do módulo.
      const dir = localDir(folder);
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, filename);
      const out = fs.createWriteStream(dest);
      file.stream.pipe(out);
      out.on('error', cb);
      out.on('finish', () => cb(null, { filename, path: dest, size: out.bytesWritten }));
    },
    _removeFile(_req, file, cb) {
      removeStored(file.path, folder).finally(() => cb(null));
    },
  };
}

/** URL pública a persistir no banco para um arquivo recém-enviado. */
export function storedFileUrl(file: Express.Multer.File, folder: Folder): string {
  if (/^https?:\/\//i.test(file.path)) return file.path; // Blob
  return `/uploads/${folder}/${file.filename}`;
}

/**
 * Remove um arquivo armazenado (best-effort, nunca lança). Aceita URL do Blob,
 * URL local (`/uploads/<pasta>/x.png`), caminho absoluto ou só o filename.
 */
async function removeStored(urlOrName: string | null | undefined, folder: Folder): Promise<void> {
  if (!urlOrName) return;
  try {
    if (/^https?:\/\//i.test(urlOrName)) {
      if (isBlobStorage() && urlOrName.includes('.blob.vercel-storage.com/')) {
        await del(urlOrName, { token: env.BLOB_READ_WRITE_TOKEN });
      }
      return;
    }
    const prefix = `/uploads/${folder}/`;
    let filename = urlOrName.startsWith(prefix) ? urlOrName.slice(prefix.length) : urlOrName;
    if (path.isAbsolute(filename)) filename = path.basename(filename);
    // Guard contra path traversal.
    if (!filename || filename.includes('/') || filename.includes('\\')) return;
    fs.unlinkSync(path.join(localDir(folder), filename));
  } catch {
    // ignora — o arquivo pode já ter sido removido.
  }
}

// =========================================================================
// Imagens de PRODUTO
// =========================================================================

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * R20 — Galeria do PRODUTO: além de imagens tradicionais, aceita GIF e MP4
 * para animar/demonstrar o produto. Limites por tipo — na Vercel o corpo da
 * requisição é limitado a 4,5 MB, então no Vercel Blob tudo fica em 4 MB
 * (o front envia um arquivo por requisição); em dev (disco) o vídeo vai a 8 MB.
 */
export const PRODUCT_MEDIA_MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB
export const PRODUCT_MEDIA_MAX_VIDEO_BYTES = isBlobStorage() ? 4 * 1024 * 1024 : 8 * 1024 * 1024;
const PRODUCT_MEDIA_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
};
export const PRODUCT_MEDIA_ALLOWED_MIMES = new Set(Object.keys(PRODUCT_MEDIA_EXT_BY_MIME));
export function classifyProductMedia(mime: string): 'image' | 'video' {
  return mime.startsWith('video/') ? 'video' : 'image';
}

function imageFileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
    return cb(HttpError.badRequest('Formato de imagem não suportado. Use JPG, PNG ou WEBP.'));
  }
  // Extensão precisa bater com o mime — bloqueia arquivos disfarçados.
  const ext = path.extname(file.originalname).toLowerCase();
  const expected = EXT_BY_MIME[file.mimetype];
  if (ext && ext !== expected && !(ext === '.jpeg' && expected === '.jpg')) {
    return cb(HttpError.badRequest('Extensão do arquivo não confere com o formato.'));
  }
  cb(null, true);
}

const imageExt = (file: Express.Multer.File) =>
  EXT_BY_MIME[file.mimetype] ?? path.extname(file.originalname).toLowerCase();

/**
 * 4 MB por imagem: a Vercel limita o corpo da requisição a 4,5 MB, então o
 * front envia as imagens de produto uma por requisição.
 */
const IMAGE_MAX_SIZE = 4 * 1024 * 1024;
const MAX_FILES = 10;

export const productImagesUpload = multer({
  storage: createStorage('products', imageExt),
  fileFilter: imageFileFilter,
  limits: { fileSize: IMAGE_MAX_SIZE, files: MAX_FILES },
});

export function safeUnlinkProductImage(urlOrFilename: string | null | undefined) {
  void removeStored(urlOrFilename, 'products');
}

// -------------------------------------------------------------------------
// Produto — MÍDIA (imagem + GIF + MP4). Mesmo armazenamento (Blob/disco) e
// nome imprevisível; troca o filtro e aplica limite por tipo (o service
// revalida o tamanho por tipo antes de persistir).
// -------------------------------------------------------------------------
function productMediaFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (!PRODUCT_MEDIA_ALLOWED_MIMES.has(file.mimetype)) {
    return cb(HttpError.badRequest('Formato não suportado. Envie JPG, PNG, WEBP, GIF ou MP4.'));
  }
  const ext = path.extname(file.originalname).toLowerCase();
  const expected = PRODUCT_MEDIA_EXT_BY_MIME[file.mimetype];
  // .jpeg é sinônimo de .jpg — aceito.
  if (ext && ext !== expected && !(ext === '.jpeg' && expected === '.jpg')) {
    return cb(HttpError.badRequest('Extensão do arquivo não confere com o formato.'));
  }
  cb(null, true);
}

export const productMediaUpload = multer({
  storage: createStorage(
    'products',
    (file) => PRODUCT_MEDIA_EXT_BY_MIME[file.mimetype] ?? path.extname(file.originalname).toLowerCase(),
  ),
  fileFilter: productMediaFilter,
  limits: { fileSize: Math.max(PRODUCT_MEDIA_MAX_IMAGE_BYTES, PRODUCT_MEDIA_MAX_VIDEO_BYTES), files: MAX_FILES },
});

// =========================================================================
// Arquivos de ORÇAMENTO (STL/OBJ/ZIP/PDF/imagens)
// =========================================================================

/**
 * Whitelist de extensão → mimes aceitáveis.
 * STL/OBJ costumam chegar como `application/octet-stream` no upload,
 * então a validação principal é pela extensão + uma lista permissiva de mimes.
 */
const QUOTE_ALLOWED: Record<string, Set<string>> = {
  '.stl': new Set(['application/octet-stream', 'application/vnd.ms-pki.stl', 'model/stl', 'application/sla']),
  '.obj': new Set(['application/octet-stream', 'text/plain', 'model/obj', 'application/x-tgif']),
  '.zip': new Set(['application/zip', 'application/x-zip-compressed', 'multipart/x-zip']),
  '.pdf': new Set(['application/pdf']),
  '.jpg': new Set(['image/jpeg']),
  '.jpeg': new Set(['image/jpeg']),
  '.png': new Set(['image/png']),
  '.webp': new Set(['image/webp']),
};

/** Extensões bloqueadas explicitamente, mesmo que o mime engane. */
const QUOTE_BLOCKED_EXTS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.dll',
  '.sh', '.bash', '.zsh',
  '.js', '.mjs', '.cjs', '.ts',
  '.html', '.htm', '.svg',
  '.php', '.py', '.rb', '.pl', '.jsp', '.asp', '.aspx',
]);

function quoteFileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (QUOTE_BLOCKED_EXTS.has(ext)) {
    return cb(HttpError.badRequest(`Extensão "${ext}" não permitida.`));
  }
  const allowed = QUOTE_ALLOWED[ext];
  if (!allowed) {
    return cb(HttpError.badRequest('Formato não suportado. Envie STL, OBJ, ZIP, PDF, JPG, PNG ou WEBP.'));
  }
  // MIME é secundário: se o browser mandou algo esperado, aceitamos.
  // Se veio "application/octet-stream" para STL/OBJ, também está permitido.
  if (!allowed.has(file.mimetype) && file.mimetype !== 'application/octet-stream') {
    return cb(HttpError.badRequest(`MIME "${file.mimetype}" não confere com a extensão "${ext}".`));
  }
  cb(null, true);
}

/**
 * 25 MB em dev; no Vercel Blob o limite real é o corpo de 4,5 MB da função
 * (arquivos maiores precisam de upload direto do navegador para o Blob).
 */
const QUOTE_MAX_SIZE = isBlobStorage() ? 4 * 1024 * 1024 : 25 * 1024 * 1024;
const QUOTE_MAX_FILES = 10;

export const quoteFilesUpload = multer({
  storage: createStorage('quotes', (file) => path.extname(file.originalname).toLowerCase()),
  fileFilter: quoteFileFilter,
  limits: { fileSize: QUOTE_MAX_SIZE, files: QUOTE_MAX_FILES },
});

export function safeUnlinkQuoteFile(urlOrFilename: string | null | undefined) {
  void removeStored(urlOrFilename, 'quotes');
}

// =========================================================================
// Conteúdo institucional do SITE (logo, banners, avatares) — R8
// =========================================================================

/**
 * Aceita apenas raster puro. **SVG é bloqueado** de propósito — pode conter
 * JavaScript e virar XSS quando renderizado em `<img>` ou inline.
 */
/** Upload single-file para logo/banner/avatar. Só um arquivo por request. */
export const siteImageUpload = multer({
  storage: createStorage('site', imageExt),
  fileFilter: imageFileFilter,
  limits: { fileSize: IMAGE_MAX_SIZE, files: 1 },
});

/** Remove um asset do site (URL do Blob, `/uploads/site/x.png` ou filename). */
export function safeUnlinkSiteImage(urlOrFilename: string | null | undefined) {
  void removeStored(urlOrFilename, 'site');
}
