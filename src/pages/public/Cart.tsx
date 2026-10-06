import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { useCartStore, getCartDiscount, getCartShipping, getCartSubtotal } from '@/store/useCartStore';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { formatBRL } from '@/utils/price';
import { useSEO } from '@/utils/seo';

export default function Cart() {
  useSEO('Carrinho');
  const {
    items, updateQty, removeItem, busyItems,
    appliedCoupon, applyCoupon, removeCoupon, revalidateCoupon, couponLoading, couponError,
  } = useCartStore();
  const products = useAdminDataStore((s) => s.products);
  const freeShippingThreshold = useAdminDataStore((s) => s.settings.freeShippingThreshold);
  const [code, setCode] = useState('');
  const navigate = useNavigate();

  const subtotal = getCartSubtotal(items, products);
  const discount = getCartDiscount(subtotal, appliedCoupon);
  const shipping = getCartShipping(subtotal, appliedCoupon, freeShippingThreshold);
  const total = subtotal - discount + shipping;

  // Revalida o cupom sempre que o subtotal mudar (remove se ficar inválido).
  useEffect(() => {
    if (appliedCoupon && subtotal > 0) revalidateCoupon(subtotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal]);

  async function tryApply() {
    if (!code.trim()) return;
    const okApplied = await applyCoupon(code, subtotal);
    if (okApplied) toast.success('Cupom aplicado!');
    setCode('');
  }

  async function changeQty(productId: string, qty: number, itemId?: string) {
    const res = await updateQty(productId, qty, itemId);
    if (!res.ok && res.error && res.error !== 'Aguarde…') toast.error(res.error);
  }
  async function remove(productId: string, itemId?: string) {
    const res = await removeItem(productId, itemId);
    if (res.ok) toast.success('Produto removido do carrinho.');
    else if (res.error && res.error !== 'Aguarde…') toast.error(res.error);
  }

  if (items.length === 0) {
    return (
      <div className="container-x py-16">
        <h1 className="mb-6 text-3xl font-bold">Carrinho</h1>
        <EmptyState
          title="Seu carrinho está vazio"
          description="Explore nosso catálogo e encontre o produto ideal."
          icon={<ShoppingBag className="h-6 w-6" />}
          action={
            <Link to="/loja" className="btn-primary">
              Ir para a loja
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="container-x py-12">
      <p className="eyebrow">Sua compra</p>
      <h1 className="section-title mb-8">Carrinho</h1>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        <div className="card divide-y divide-ink-line">
          {items.map((it) => {
            const p = products.find((x) => x.id === it.productId);
            if (!p) return null;
            const unit = p.promoPrice ?? p.price;
            const busy = it.variationId ? busyItems.includes(it.variationId) : false;
            return (
              <div key={p.id + (it.variationId ?? '')} className="flex gap-4 p-5">
                <img src={p.images[0]} alt={p.name} className="h-24 w-24 flex-shrink-0 rounded-xl object-cover" />
                <div className="flex flex-1 flex-col">
                  <Link to={`/produto/${p.slug}`} className="font-semibold hover:underline">
                    {p.name}
                  </Link>
                  {it.variationLabel && <span className="text-xs text-ink-mute">{it.variationLabel}</span>}
                  <p className="mt-1 text-sm text-ink-mute">{formatBRL(unit)} cada</p>
                  <div className="mt-auto flex items-end justify-between">
                    <div className={`inline-flex items-center rounded-xl border border-ink-line ${busy ? 'opacity-50' : ''}`}>
                      <button
                        className="p-2 hover:bg-ink/5 disabled:cursor-not-allowed"
                        onClick={() => changeQty(p.id, it.qty - 1, it.variationId)}
                        disabled={busy}
                        aria-label="Diminuir"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="min-w-9 text-center text-sm font-semibold">{it.qty}</span>
                      <button
                        className="p-2 hover:bg-ink/5 disabled:cursor-not-allowed"
                        onClick={() => changeQty(p.id, it.qty + 1, it.variationId)}
                        disabled={busy}
                        aria-label="Aumentar"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{formatBRL(unit * it.qty)}</p>
                      <button
                        onClick={() => remove(p.id, it.variationId)}
                        disabled={busy}
                        className="text-xs text-ink-mute hover:text-rose-500 inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" /> Remover
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <aside className="card sticky top-24 h-fit p-5">
          <h2 className="text-base font-bold">Resumo</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-mute">Subtotal</dt>
              <dd>{formatBRL(subtotal)}</dd>
            </div>
            {appliedCoupon ? (
              <div className="flex justify-between text-emerald-600">
                <dt>
                  Cupom {appliedCoupon.code}{' '}
                  <button onClick={removeCoupon} className="text-xs underline">
                    remover
                  </button>
                </dt>
                <dd>{appliedCoupon.freeShipping ? 'Frete grátis' : `-${formatBRL(discount)}`}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-ink-mute">Frete</dt>
              <dd>{shipping === 0 ? 'Grátis' : formatBRL(shipping)}</dd>
            </div>
            <div className="mt-2 flex justify-between border-t border-ink-line pt-3 text-lg font-bold">
              <dt>Total</dt>
              <dd>{formatBRL(total)}</dd>
            </div>
          </dl>

          {!appliedCoupon && (
            <div className="mt-5">
              <p className="label">Cupom de desconto</p>
              <div className="flex gap-2">
                <Input
                  placeholder="Código do cupom"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && tryApply()}
                />
                <Button variant="secondary" onClick={tryApply} loading={couponLoading}>
                  Aplicar
                </Button>
              </div>
              {couponError && <p className="mt-2 text-[11px] text-rose-500">{couponError}</p>}
            </div>
          )}

          <p className="mt-4 text-[11px] text-ink-mute">
            Frete grátis (PAC) acima de {formatBRL(freeShippingThreshold)}. Valor final calculado no checkout.
          </p>

          <Button fullWidth className="mt-5" onClick={() => navigate('/checkout')}>
            Finalizar compra
          </Button>
          <Link to="/loja" className="mt-3 block text-center text-xs font-semibold text-ink-mute hover:text-ink">
            ← Continuar comprando
          </Link>
        </aside>
      </div>
    </div>
  );
}
