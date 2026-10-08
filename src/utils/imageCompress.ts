/**
 * Reduz uma foto no navegador antes do upload: o backend aceita até 4 MB por
 * imagem, e foto de câmera/print costuma passar disso. Redimensiona para no
 * máx. `maxSide` px e converte para WEBP (ou JPEG se o navegador não gerar
 * WEBP), até caber em `maxBytes`.
 *
 * GIF e SVG voltam intactos (animação / vetor) — quem chama valida o tamanho.
 */
const DEFAULT_TARGET_BYTES = 3.5 * 1024 * 1024;

/** Formatos que dá para reduzir no navegador. */
export const COMPRESSIBLE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function compressImageForUpload(
  file: File,
  maxSide = 1600,
  maxBytes = DEFAULT_TARGET_BYTES,
): Promise<File> {
  if (!COMPRESSIBLE_IMAGE_TYPES.includes(file.type)) return file;

  const bitmap = await createImageBitmap(file);
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'imagem';
  try {
    let side = maxSide;
    let quality = 0.85;
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      let blob = await toBlob(canvas, 'image/webp', quality);
      if (!blob || blob.type !== 'image/webp') {
        // Sem WEBP (Safari antigo): JPEG com fundo branco no lugar da transparência.
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        blob = await toBlob(canvas, 'image/jpeg', quality);
      }
      if (blob && blob.size <= maxBytes) {
        const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
        return new File([blob], `${baseName}.${ext}`, { type: blob.type });
      }
      side = Math.round(side * 0.75);
      quality = Math.max(0.6, quality - 0.1);
    }
  } finally {
    bitmap.close();
  }
  throw new Error(`Não foi possível reduzir a imagem para menos de ${formatMB(maxBytes)}.`);
}

/** "4 MB", "0,9 MB" — para mensagens ao admin. */
export function formatMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 1 ? Math.round(mb) : mb.toFixed(1).replace('.', ',')} MB`;
}
