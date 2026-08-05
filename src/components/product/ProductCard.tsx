import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MessageCircle, ShoppingBag } from 'lucide-react';
import type { Product } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { formatBRL, getDiscountPercent, getEffectivePrice, getPixPrice } from '@/utils/price';
import { useCartStore } from '@/store/useCartStore';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '@/store/useUIStore';
import { whatsappProduct } from '@/utils/whatsapp';

export function ProductCard({ product }: { product: Product }) {
  const addItem = useCartStore((s) => s.addItem);
  const setCartOpen = useUIStore((s) => s.setCartOpen);
  const navigate = useNavigate();
  const effective = getEffectivePrice(product);
  const pix = getPixPrice(product);
  const discount = getDiscountPercent(product);
  const isOutOfStock = product.stock <= 0;
  const isQuoteOnly = product.purchaseMode === 'quote';

  async function handleAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (isOutOfStock) return;
    const res = await addItem(product.id, 1);
    if (res.ok) {
      toast.success(`${product.name} adicionado ao carrinho`);
      setCartOpen(true);
    } else if (res.requiresAuth) {
      toast.error('Faça login para adicionar ao carrinho.');
      navigate('/login');
    } else {
      toast.error(res.error ?? 'Não foi possível adicionar ao carrinho.');
    }
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.35 }}
      whileHover={{ y: -4 }}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-ink-line/70 bg-bg-card shadow-soft transition-all duration-300 hover:border-ink/20 hover:shadow-[0_20px_50px_-15px_rgba(15,17,21,0.18)]"
    >
      <Link to={`/produto/${product.slug}`} className="relative block overflow-hidden bg-bg-soft">
        <div className="absolute left-3 top-3 z-10 flex flex-col gap-1">
          {product.badges.slice(0, 2).map((b) => (
            <Badge key={b} type={b} />
          ))}
          {discount > 0 && !product.badges.includes('oferta') && (
            <span className="rounded-md bg-rose-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm shadow-rose-500/30">
              -{discount}%
            </span>
          )}
        </div>
        {(() => {
          // R20 — Prefere a 1ª IMAGEM (miniatura estática); só usa vídeo
          // se o produto só tiver MP4 na galeria (evita autoplay em massa
          // na listagem, que ficaria pesado).
          const firstImage = product.media?.find((m) => m.mediaType === 'image');
          const src = firstImage?.url ?? product.images[0];
          const isVideo = !firstImage && /\.mp4($|\?)/i.test(src ?? '');
          return isVideo ? (
            <video
              src={src}
              muted
              playsInline
              preload="metadata"
              className="aspect-square w-full object-cover transition-transform duration-[600ms] ease-out group-hover:scale-[1.06]"
              aria-label={product.name}
            />
          ) : (
            <img
              src={src}
              alt={product.name}
              loading="lazy"
              className="aspect-square w-full object-cover transition-transform duration-[600ms] ease-out group-hover:scale-[1.06]"
            />
          );
        })()}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      </Link>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-mute">{product.brand}</p>
        <Link to={`/produto/${product.slug}`} className="mt-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-ink transition-colors group-hover:text-graphite-dark">
            {product.name}
          </h3>
        </Link>

        <div className="mt-3 space-y-0.5">
          {/* Altura reservada para o preço riscado: mantém todos os cards alinhados,
              tenham ou não preço promocional. */}
          <p className="h-4 text-xs text-ink-mute line-through tabular-nums">
            {product.promoPrice ? formatBRL(product.price) : ' '}
          </p>
          <p className="price-display text-xl font-bold leading-none text-ink">{formatBRL(effective)}</p>
          <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {formatBRL(pix)} no Pix
          </p>
        </div>

        <div className="mt-auto flex gap-2 pt-4">
          {isQuoteOnly ? (
            <a
              href={whatsappProduct(product)}
              target="_blank"
              rel="noreferrer"
              className="btn-whatsapp flex-1 !py-2"
              onClick={(e) => e.stopPropagation()}
            >
              <MessageCircle className="h-3.5 w-3.5" /> Orçamento
            </a>
          ) : (
            <>
              <button
                onClick={handleAdd}
                disabled={isOutOfStock}
                className="btn-primary flex-1 !py-2"
                aria-label={`Adicionar ${product.name} ao carrinho`}
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                {isOutOfStock ? 'Esgotado' : 'Adicionar'}
              </button>
              {product.purchaseMode === 'both' && (
                <a
                  href={whatsappProduct(product)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-xl border border-ink-line bg-bg-soft px-2.5 transition hover:border-emerald-400 hover:bg-emerald-50"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Tirar dúvida no WhatsApp"
                >
                  <MessageCircle className="h-4 w-4 text-emerald-600" />
                </a>
              )}
            </>
          )}
        </div>
      </div>
    </motion.article>
  );
}
