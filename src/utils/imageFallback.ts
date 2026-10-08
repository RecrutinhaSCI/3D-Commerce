import { productSvg } from './productImage';

/**
 * Qualquer <img> que falhar ao carregar (arquivo apagado, URL antiga de
 * /uploads/... que não existe mais na Vercel) troca para o placeholder da loja
 * em vez de mostrar o ícone de imagem quebrada do navegador.
 *
 * Um listener só, em fase de captura (o evento `error` de imagem não borbulha).
 * Para tratar o erro no próprio componente, marque a tag com `data-no-fallback`.
 */
export function installImageFallback() {
  window.addEventListener(
    'error',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLImageElement)) return;
      if ('noFallback' in el.dataset) return;
      if (el.currentSrc.startsWith('data:') || el.src.startsWith('data:')) return; // evita loop
      el.removeAttribute('srcset');
      el.src = productSvg(el.alt || '3D Commerce');
    },
    true,
  );
}
