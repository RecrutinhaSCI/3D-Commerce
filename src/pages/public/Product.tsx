import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, MessageCircle, Minus, PackageX, Plus, ShieldCheck, ShoppingBag, Truck, Wrench } from 'lucide-react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { useCartStore } from '@/store/useCartStore';
import { useUIStore } from '@/store/useUIStore';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ShowcaseSection } from '@/components/home/ShowcaseSection';
import { Markdown } from '@/components/ui/Markdown';
import { Collapsible } from '@/components/ui/Collapsible';
import { formatBRL, getDiscountPercent, getEffectivePrice, getPixPrice, calcInstallment } from '@/utils/price';
import { whatsappProduct, whatsappQuoteProduct } from '@/utils/whatsapp';
import { useSEO, useJsonLd } from '@/utils/seo';

const LOW_STOCK_THRESHOLD = 5;

export default function Product() {
  const { slug } = useParams();
  const products = useAdminDataStore((s) => s.products);
  const categories = useAdminDataStore((s) => s.categories);
  const settings = useAdminDataStore((s) => s.settings);
  const product = products.find((p) => p.slug === slug);
  const addItem = useCartStore((s) => s.addItem);
  const setCartOpen = useUIStore((s) => s.setCartOpen);
  const navigate = useNavigate();

  const [imageIdx, setImageIdx] = useState(0);
  // R20 — Galeria com mídias tipadas (imagem/vídeo). Fallback para o array
  // de URLs legado quando `media` ainda não veio (produto do cache antigo).
  const gallery = product?.media && product.media.length > 0
    ? product.media
    : (product?.images ?? []).map((url) => ({
        url,
        mediaType: /\.mp4($|\?)/i.test(url) ? ('video' as const) : ('image' as const),
        mimeType: null,
      }));
  const currentMedia = gallery[imageIdx];
  const [qty, setQty] = useState(1);
  const [selectedVar, setSelectedVar] = useState<string | undefined>(product?.variations[0]?.id);

  useSEO(product?.name ?? 'Produto', product?.shortDescription);

  const category = useMemo(
    () => categories.find((c) => product?.categoryIds.includes(c.id)),
    [categories, product],
  );

  const related = useMemo(() => {
    if (!product) return [];
    return products
      .filter((p) => p.id !== product.id && p.categoryIds.some((c) => product.categoryIds.includes(c)) && p.active)
      .slice(0, 4);
  }, [products, product]);

  // JSON-LD Product (SEO). Só injeta com produto válido.
  const productUrl = typeof window !== 'undefined' ? window.location.href : '';
  useJsonLd(
    product
      ? {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: product.name,
          description: product.shortDescription || product.name,
          image: product.images.filter((i) => /^https?:/i.test(i) && !/\.mp4($|\?)/i.test(i)),
          brand: { '@type': 'Brand', name: product.brand },
          offers: {
            '@type': 'Offer',
            price: getEffectivePrice(product),
            priceCurrency: 'BRL',
            availability:
              product.stock > 0
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
            url: productUrl,
          },
        }
      : null,
  );

  if (!product) {
    return (
      <div className="container-x py-20 text-center">
        <h1 className="text-2xl font-bold">Produto não encontrado</h1>
        <Link to="/loja" className="mt-4 inline-block text-sm font-semibold text-ink-soft hover:underline">
          ← Voltar para a loja
        </Link>
      </div>
    );
  }

  const variation = product.variations.find((v) => v.id === selectedVar);
  const variationDelta = variation?.priceDelta ?? 0;
  const basePrice = getEffectivePrice(product) + variationDelta;
  const fullPrice = product.price + variationDelta;
  const pix = getPixPrice({ ...product, price: fullPrice, promoPrice: product.promoPrice ? basePrice : undefined });
  const discount = getDiscountPercent(product);
  const installment = calcInstallment(basePrice);
  const isQuoteOnly = product.purchaseMode === 'quote';
  const isOutOfStock = product.stock <= 0;
  const isLowStock = !isQuoteOnly && product.stock > 0 && product.stock <= LOW_STOCK_THRESHOLD;
  const savings = product.promoPrice ? fullPrice - basePrice : 0;
  const quoteHref = whatsappQuoteProduct(product, qty, productUrl, variation?.label);
  const descText = product.description?.trim() || product.shortDescription?.trim() || '';
  const hasSpecs = Object.keys(product.attributes).length > 0;

  async function addToCart() {
    if (isOutOfStock || isQuoteOnly) return;
    const res = await addItem(product!.id, qty, variation?.id, variation?.label);
    if (res.ok) {
      toast.success(`${product!.name} adicionado ao carrinho`);
      setCartOpen(true); // abre a gaveta só depois de o item estar no estado
    } else if (res.requiresAuth) {
      toast.error('Faça login para adicionar ao carrinho.');
      navigate('/login');
    } else {
      toast.error(res.error ?? 'Não foi possível adicionar ao carrinho.');
    }
  }

  async function buyNow() {
    if (isOutOfStock || isQuoteOnly) return;
    const res = await addItem(product!.id, qty, variation?.id, variation?.label);
    if (res.ok) {
      navigate('/checkout');
    } else if (res.requiresAuth) {
      toast.error('Faça login para finalizar a compra.');
      navigate('/login');
    } else {
      toast.error(res.error ?? 'Não foi possível continuar.');
    }
  }

  return (
    <div className="container-x py-8">
      <nav className="mb-5 flex flex-wrap items-center gap-1 text-xs text-ink-mute">
        <Link to="/" className="hover:text-ink">Início</Link>
        <ChevronRight className="h-3 w-3" />
        {category ? (
          <>
            <Link to={`/categoria/${category.slug}`} className="hover:text-ink">{category.name}</Link>
            <ChevronRight className="h-3 w-3" />
          </>
        ) : (
          <>
            <Link to="/loja" className="hover:text-ink">Loja</Link>
            <ChevronRight className="h-3 w-3" />
          </>
        )}
        <span className="truncate text-ink">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <div>
          <motion.div
            key={imageIdx}
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 1 }}
            className="relative aspect-square overflow-hidden rounded-3xl border border-ink-line bg-bg-card"
          >
            <div className="absolute left-3 top-3 z-10 flex flex-col gap-1">
              {product.badges.slice(0, 3).map((b) => (
                <Badge key={b} type={b} />
              ))}
            </div>
            {currentMedia?.mediaType === 'video' ? (
              // MP4: `muted + playsInline` liberam autoplay silencioso no iOS.
              // `preload="metadata"` evita baixar o arquivo inteiro antes de o
              // usuário chegar na tela do produto.
              <video
                key={currentMedia.url}
                src={currentMedia.url}
                autoPlay
                muted
                loop
                playsInline
                controls
                preload="metadata"
                className="h-full w-full object-cover"
                aria-label={`${product.name} — vídeo`}
              />
            ) : (
              <img
                src={currentMedia?.url}
                alt={product.name}
                loading="eager"
                onError={(e) => {
                  // Fallback elegante: some com a imagem quebrada e revela o fundo do card.
                  (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                }}
                className="h-full w-full object-cover"
              />
            )}
          </motion.div>
          {gallery.length > 1 && (
            <div className="mt-3 grid grid-cols-5 gap-2">
              {gallery.map((m, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setImageIdx(i)}
                  aria-label={m.mediaType === 'video' ? `Vídeo ${i + 1}` : `Imagem ${i + 1}`}
                  className={`relative overflow-hidden rounded-xl border-2 ${i === imageIdx ? 'border-ink' : 'border-transparent'}`}
                >
                  {m.mediaType === 'video' ? (
                    <>
                      <video
                        src={m.url}
                        muted
                        playsInline
                        preload="metadata"
                        className="aspect-square w-full object-cover"
                      />
                      {/* Selo visual para diferenciar vídeo de imagem na miniatura */}
                      <span className="absolute bottom-1 right-1 rounded bg-ink/80 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-bg">
                        Vídeo
                      </span>
                    </>
                  ) : (
                    <img src={m.url} alt="" className="aspect-square w-full object-cover" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">{product.brand}</p>
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-tight md:text-[2.5rem]">{product.name}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-mute">{product.shortDescription}</p>

          <div className="mt-7 rounded-2xl border border-ink-line/70 bg-bg-soft/50 p-5">
            {product.promoPrice && (
              <p className="text-sm text-ink-mute line-through tabular-nums">{formatBRL(fullPrice)}</p>
            )}
            <div className="flex items-end gap-3">
              <p className="price-display text-[2.75rem] font-bold leading-none text-ink">{formatBRL(basePrice)}</p>
              {discount > 0 && (
                <span className="rounded-md bg-rose-500 px-2 py-1 text-xs font-bold text-white shadow-sm shadow-rose-500/30">-{discount}%</span>
              )}
            </div>
            {savings > 0 && (
              <p className="mt-1.5 text-sm font-semibold text-emerald-600">
                Você economiza {formatBRL(savings)} ({discount}%)
              </p>
            )}
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {formatBRL(pix)} no Pix
              <span className="font-normal text-ink-mute">(5% off)</span>
            </p>
            <p className="mt-1 text-xs text-ink-mute">
              ou {installment.qty}x de {formatBRL(installment.value)} sem juros
            </p>
          </div>

          {product.variations.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-mute">Variação</p>
              <div className="flex flex-wrap gap-2">
                {product.variations.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVar(v.id)}
                    disabled={!v.inStock}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                      selectedVar === v.id
                        ? 'border-ink bg-ink text-bg'
                        : 'border-ink-line bg-bg-card text-ink hover:border-ink'
                    } ${!v.inStock ? 'opacity-50' : ''}`}
                  >
                    {v.swatch && <span className="mr-1.5 inline-block h-3 w-3 rounded-full" style={{ background: v.swatch }} />}
                    {v.label}
                    {v.priceDelta ? <span className="ml-1 opacity-70">+{formatBRL(v.priceDelta)}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isOutOfStock && !isQuoteOnly && (
            <div className="mt-6 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
              <PackageX className="h-4 w-4" /> Produto indisponível no momento
            </div>
          )}

          {!isOutOfStock && (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-mute">Quantidade</p>
              <div className="inline-flex items-center rounded-xl border border-ink-line">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="p-2 hover:bg-ink/5" aria-label="Diminuir">
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-9 text-center text-sm font-semibold">{qty}</span>
                <button onClick={() => setQty((q) => q + 1)} className="p-2 hover:bg-ink/5" aria-label="Aumentar">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              {!isQuoteOnly &&
                (isLowStock ? (
                  <span className="text-xs font-semibold text-amber-600">
                    Poucas unidades ({product.stock} restante{product.stock > 1 ? 's' : ''})
                  </span>
                ) : (
                  <span className="text-xs text-emerald-600">{product.stock} em estoque</span>
                ))}
            </div>
          )}

          <div className="mt-6 space-y-3">
            {isQuoteOnly ? (
              <a href={quoteHref} target="_blank" rel="noopener noreferrer" className="btn-whatsapp w-full">
                <MessageCircle className="h-4 w-4" /> Solicitar orçamento via WhatsApp
              </a>
            ) : (
              <>
                <Button fullWidth size="lg" onClick={buyNow} disabled={isOutOfStock}>
                  <ShoppingBag className="h-4 w-4" /> {isOutOfStock ? 'Produto indisponível' : 'Comprar agora'}
                </Button>
                <Button fullWidth size="lg" variant="secondary" onClick={addToCart} disabled={isOutOfStock}>
                  Adicionar ao carrinho
                </Button>
              </>
            )}
            {product.purchaseMode === 'both' && (
              <a href={quoteHref} target="_blank" rel="noopener noreferrer" className="btn-whatsapp w-full">
                <MessageCircle className="h-4 w-4" /> Solicitar orçamento
              </a>
            )}
            {product.purchaseMode === 'direct' && (
              <a
                href={quoteHref}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center text-xs font-semibold text-ink-mute hover:text-emerald-600"
              >
                Tirar dúvida ou pedir orçamento pelo WhatsApp →
              </a>
            )}
          </div>

          {(() => {
            const customTrust = settings.trustBlockEnabled
              ? settings.trustItems.filter((t) => t.enabled !== false && t.title)
              : [];
            if (customTrust.length > 0) {
              // Itens editáveis via Configurações (fallback: grid fixo abaixo).
              return (
                <ul className="mt-8 grid grid-cols-1 gap-3 border-t border-ink-line pt-6 text-xs text-ink-soft sm:grid-cols-2">
                  {customTrust.map((t, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-bg-soft text-ink">
                        <ShieldCheck className="h-3.5 w-3.5" />
                      </span>
                      <span>
                        <b className="text-ink">{t.title}</b>
                        {t.description && <span className="block text-ink-mute">{t.description}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              );
            }
            return (
              <ul className="mt-8 grid grid-cols-2 gap-3 border-t border-ink-line pt-6 text-xs text-ink-soft">
                <li className="flex items-center gap-2"><span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-bg-soft text-ink"><Truck className="h-3.5 w-3.5" /></span> Envio para todo Brasil</li>
                <li className="flex items-center gap-2"><span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-bg-soft text-ink"><ShieldCheck className="h-3.5 w-3.5" /></span> Compra segura</li>
                <li className="flex items-center gap-2"><span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-bg-soft text-ink"><Wrench className="h-3.5 w-3.5" /></span> Suporte técnico incluso</li>
                <li className="flex items-center gap-2"><span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-bg-soft text-ink"><MessageCircle className="h-3.5 w-3.5" /></span> Atendimento direto</li>
              </ul>
            );
          })()}
          <p className="mt-4 rounded-xl bg-bg-soft/60 p-3 text-xs leading-relaxed text-ink-mute">
            Finalize seu pedido ou solicite um orçamento para confirmar detalhes de produção e envio.
            Nossa equipe pode entrar em contato para alinhar personalização, prazo e entrega.
          </p>
        </div>
      </div>

      {(descText || hasSpecs) && (
        <section className="mt-14 grid grid-cols-1 gap-8 lg:grid-cols-3">
          {descText && (
            <div className={`card p-6 ${hasSpecs ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
              <h2 className="text-lg font-bold">Descrição do produto</h2>
              <Collapsible collapsedHeight={220}>
                <Markdown content={descText} className="mt-3" />
              </Collapsible>
            </div>
          )}
          {hasSpecs && (
            <div className={`card p-6 ${descText ? '' : 'lg:col-span-3'}`}>
              <h2 className="text-lg font-bold">Especificações</h2>
              <dl className="mt-3 space-y-2 text-sm">
                {Object.entries(product.attributes).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-ink-line/50 pb-1.5">
                    <dt className="text-ink-mute">{k}</dt>
                    <dd className="text-right font-medium text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>
      )}

      {related.length > 0 && (
        <ShowcaseSection eyebrow="Você também pode gostar" title="Produtos relacionados" products={related} />
      )}
    </div>
  );
}
