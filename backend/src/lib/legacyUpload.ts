/**
 * URL de arquivo no formato antigo de disco (`/uploads/<pasta>/<arquivo>`),
 * relativa ou absoluta (`https://<backend>/uploads/...` — o admin de banners
 * regravava a URL já prefixada com o host da API). Com o Vercel Blob ativo,
 * esses arquivos não existem mais: o disco do Render/Vercel é efêmero.
 *
 * `/uploads/seed/...` fica de fora: são as imagens do seed, versionadas em
 * `public/` e sempre servidas.
 */
const LEGACY_PATH_RE = /^\/uploads\/(?!seed\/)[^/]+\/[^/]+$/;

/** Caminho `/uploads/<pasta>/<arquivo>` da URL (relativa ou absoluta), ou null. */
export function legacyUploadPath(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (LEGACY_PATH_RE.test(v)) return v;
  if (!/^https?:\/\//i.test(v) || v.includes('.blob.vercel-storage.com/')) return null;
  try {
    const { pathname } = new URL(v);
    return LEGACY_PATH_RE.test(pathname) ? pathname : null;
  } catch {
    return null;
  }
}

export const isLegacyUploadUrl = (v: unknown): v is string => legacyUploadPath(v) !== null;
