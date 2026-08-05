import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import type { Request } from 'express';
import { env } from '../config/env';
import { HttpError } from '../utils/httpError';

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * R20 — Galeria do PRODUTO: além de imagens tradicionais, aceita GIF e MP4
 * para animar/demonstrar o produto. Limites diferentes por tipo mantêm o
 * bundle da página leve mesmo com vídeo.
 */
export const PRODUCT_MEDIA_MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const PRODUCT_MEDIA_MAX_VIDEO_BYTES = 8 * 1024 * 1024; // 8 MB
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

/** Diretório absoluto para imagens de produtos. Criado se não existir. */
const productsDir = path.resolve(process.cwd(), env.UPLOAD_DIR, 'products');
fs.mkdirSync(productsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, productsDir),
  filename: (_req, file, cb) => {
    // Nome imprevisível: 32 hex + extensão sanitizada pelo mime.
    const rand = crypto.randomBytes(16).toString('hex');
    const ext = EXT_BY_MIME[file.mimetype] ?? path.extname(file.originalname).toLowerCase();
    cb(null, `${rand}${ext}`);
  },
});

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
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

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_FILES = 10;

export const productImagesUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE_BYTES, files: MAX_FILES },
});

// -------------------------------------------------------------------------
// Produto — MÍDIA (imagem + GIF + MP4). Compartilha o diretório e as regras
// de nome imprevisível; troca o filtro e aplica limite por tipo.
// -------------------------------------------------------------------------
const productMediaStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, productsDir),
  filename: (_req, file, cb) => {
    const rand = crypto.randomBytes(16).toString('hex');
    const ext = PRODUCT_MEDIA_EXT_BY_MIME[file.mimetype] ?? path.extname(file.originalname).toLowerCase();
    cb(null, `${rand}${ext}`);
  },
});

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
  storage: productMediaStorage,
  fileFilter: productMediaFilter,
  // Limite mais folgado (vídeo): o service ainda valida o tamanho por tipo
  // antes de persistir, para bloquear imagem >5MB mesmo que <8MB.
  limits: { fileSize: PRODUCT_MEDIA_MAX_VIDEO_BYTES, files: MAX_FILES },
});

/** Constrói a URL pública servida por `/uploads/products/<filename>`. */
export function productImageUrl(filename: string): string {
  return `/uploads/products/${filename}`;
}

/** Best-effort: remove o arquivo do disco (não falha se não existir). */
export function safeUnlinkProductImage(filename: string) {
  try {
    fs.unlinkSync(path.join(productsDir, filename));
  } catch {
    // ignora erros — o arquivo pode já ter sido removido manualmente.
  }
}

// =========================================================================
// Uploads de arquivos de ORÇAMENTO (STL/OBJ/ZIP/PDF/imagens)
// =========================================================================

const quotesDir = path.resolve(process.cwd(), env.UPLOAD_DIR, 'quotes');
fs.mkdirSync(quotesDir, { recursive: true });

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

const quoteStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, quotesDir),
  filename: (_req, file, cb) => {
    const rand = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${rand}${ext}`);
  },
});

const QUOTE_MAX_SIZE = 25 * 1024 * 1024; // 25 MB
const QUOTE_MAX_FILES = 10;

export const quoteFilesUpload = multer({
  storage: quoteStorage,
  fileFilter: quoteFileFilter,
  limits: { fileSize: QUOTE_MAX_SIZE, files: QUOTE_MAX_FILES },
});

export function quoteFileUrl(filename: string): string {
  return `/uploads/quotes/${filename}`;
}

export function safeUnlinkQuoteFile(filename: string) {
  try {
    fs.unlinkSync(path.join(quotesDir, filename));
  } catch {
    // ignora
  }
}

// =========================================================================
// Uploads de conteúdo institucional do SITE (logo, banners, avatares) — R8
// =========================================================================

const siteDir = path.resolve(process.cwd(), env.UPLOAD_DIR, 'site');
fs.mkdirSync(siteDir, { recursive: true });

/**
 * Aceita apenas raster puro. **SVG é bloqueado** de propósito — pode conter
 * JavaScript e virar XSS reflected quando renderizado em `<img>` ou inline.
 */
const SITE_ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function siteFileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (!SITE_ALLOWED_IMAGE_MIME.has(file.mimetype)) {
    return cb(HttpError.badRequest('Formato não suportado. Envie JPG, PNG ou WEBP.'));
  }
  const ext = path.extname(file.originalname).toLowerCase();
  const expected = EXT_BY_MIME[file.mimetype];
  if (ext && ext !== expected && !(ext === '.jpeg' && expected === '.jpg')) {
    return cb(HttpError.badRequest('Extensão do arquivo não confere com o formato.'));
  }
  cb(null, true);
}

const siteStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, siteDir),
  filename: (_req, file, cb) => {
    const rand = crypto.randomBytes(16).toString('hex');
    const ext = EXT_BY_MIME[file.mimetype] ?? path.extname(file.originalname).toLowerCase();
    cb(null, `${rand}${ext}`);
  },
});

const SITE_MAX_SIZE = 5 * 1024 * 1024; // 5 MB

/** Upload single-file para logo/banner/avatar. Só um arquivo por request. */
export const siteImageUpload = multer({
  storage: siteStorage,
  fileFilter: siteFileFilter,
  limits: { fileSize: SITE_MAX_SIZE, files: 1 },
});

/** URL pública servida por `/uploads/site/<filename>`. */
export function siteImageUrl(filename: string): string {
  return `/uploads/site/${filename}`;
}

/**
 * Remove um asset do site do disco. Aceita URL relativa (`/uploads/site/x.png`)
 * ou só o filename. Silencioso se o arquivo não existir.
 */
export function safeUnlinkSiteImage(urlOrFilename: string | null | undefined) {
  if (!urlOrFilename) return;
  const prefix = '/uploads/site/';
  const filename = urlOrFilename.startsWith(prefix)
    ? urlOrFilename.slice(prefix.length)
    : urlOrFilename;
  if (!filename || filename.includes('/') || filename.includes('\\')) return;
  try {
    fs.unlinkSync(path.join(siteDir, filename));
  } catch {
    // ignora
  }
}
