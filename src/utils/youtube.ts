/**
 * Extrai o ID de um vídeo do YouTube a partir de várias formas comuns:
 *  - https://www.youtube.com/watch?v=ID
 *  - https://youtu.be/ID
 *  - https://www.youtube.com/embed/ID
 *  - https://www.youtube.com/shorts/ID
 * Retorna null quando não conseguimos identificar (URL de canal, etc.).
 */
export function extractYouTubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url.trim();
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** URL da thumbnail automática do YouTube (hqdefault existe para 99% dos vídeos). */
export function youtubeAutoThumb(url: string | null | undefined): string | null {
  const id = extractYouTubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}
