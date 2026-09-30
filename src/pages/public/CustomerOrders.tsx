import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AlertCircle, ChevronRight, ExternalLink, MapPin, Package, Truck } from 'lucide-react';
import { useCurrentCustomer } from '@/store/useCustomerAuthStore';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { PaymentStatusBadge } from '@/components/admin/PaymentStatusBadge';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { formatBRL } from '@/utils/price';
import { fetchTracking } from '@/services/tracking';
import type { Order, TrackingResult } from '@/types';
import { useSEO } from '@/utils/seo';

function formatEventDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TrackingSection({ code }: { code: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrackingResult | null>(null);

  async function handleTrack() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTracking(code);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao consultar o rastreio.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-ink-line p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">Rastreamento</p>
          <p className="mt-0.5 font-mono text-sm font-semibold tracking-wide">{code}</p>
        </div>
        <Button size="sm" variant="secondary" loading={loading} onClick={handleTrack}>
          <Truck className="h-4 w-4" /> Rastrear entrega
        </Button>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>{error}</p>
            <button onClick={handleTrack} className="mt-1 font-semibold underline">
              Tentar novamente
            </button>
          </div>
        </div>
      )}

      {result && !error && (
        <div className="mt-4">
          {result.carrierName && (
            <p className="mb-2 text-xs text-ink-mute">
              Transportadora: <span className="font-semibold text-ink">{result.carrierName}</span>
            </p>
          )}

          {result.historico.length === 0 ? (
            <p className="text-sm text-ink-mute">
              Ainda não há eventos de rastreamento para este código.
            </p>
          ) : (
            <ol className="relative space-y-4 border-l border-ink-line pl-5">
              {result.historico.map((ev, i) => (
                <li key={i} className="relative">
                  <span
                    className={`absolute -left-[1.4rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-bg ${
                      i === 0 ? 'bg-ink' : 'bg-ink-line'
                    }`}
                  />
                  <p className={`text-sm ${i === 0 ? 'font-semibold text-ink' : 'text-ink-soft'}`}>
                    {ev.descricao}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-mute">
                    <span>{formatEventDate(ev.data)}</span>
                    {ev.local && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {ev.local}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {result.previsaoEntrega && (
            <p className="mt-3 text-xs text-ink-mute">
              Previsão de entrega:{' '}
              <span className="font-semibold text-ink">
                {new Date(result.previsaoEntrega).toLocaleDateString('pt-BR')}
              </span>
            </p>
          )}

          {result.linkDetalhesCompletos && (
            <a
              href={result.linkDetalhesCompletos}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-ink hover:underline"
            >
              Ver detalhes completos <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function CustomerOrders() {
  useSEO('Meus pedidos');
  const customer = useCurrentCustomer();
  const orders = useAdminDataStore((s) => s.orders);
  const [active, setActive] = useState<Order | null>(null);

  if (!customer) return <Navigate to="/login" replace />;

  const mine = orders.filter((o) => o.customerId === customer.id);

  return (
    <div className="container-x py-12">
      <p className="eyebrow">Minha conta</p>
      <h1 className="section-title">Meus pedidos</h1>
      <p className="mt-2 text-sm text-ink-mute">
        Acompanhe o status dos seus pedidos na 3DCommerce.
      </p>

      {mine.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Você ainda não tem pedidos."
            description="Quando finalizar uma compra logado(a), ela aparece aqui."
            icon={<Package className="h-6 w-6" />}
            action={
              <Link to="/loja" className="btn-primary">
                Ver produtos
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {mine
            .slice()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((o) => (
              <button
                key={o.id}
                onClick={() => setActive(o)}
                className="card flex w-full items-center justify-between gap-4 p-5 text-left transition hover:-translate-y-0.5 hover:border-ink/20 hover:shadow-card"
              >
                <div>
                  <p className="text-sm font-bold tabular-nums">{o.id}</p>
                  <p className="mt-0.5 text-xs text-ink-mute">
                    {new Date(o.createdAt).toLocaleDateString('pt-BR')} · {o.items.length} item(s)
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={o.status} />
                    {o.paymentStatus && <PaymentStatusBadge status={o.paymentStatus} />}
                  </div>
                  <p className="price-display text-sm font-bold tabular-nums">{formatBRL(o.total)}</p>
                  <ChevronRight className="h-4 w-4 text-ink-mute" />
                </div>
              </button>
            ))}
        </div>
      )}

      <Drawer open={!!active} onClose={() => setActive(null)} title={active?.id ?? 'Pedido'}>
        {active && (
          <div className="space-y-5 p-5 text-sm">
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={active.status} />
                {active.paymentStatus && <PaymentStatusBadge status={active.paymentStatus} />}
              </div>
              <span className="text-xs text-ink-mute">
                {new Date(active.createdAt).toLocaleDateString('pt-BR')}
              </span>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">Itens</p>
              <ul className="mt-2 divide-y divide-ink-line">
                {active.items.map((it, i) => (
                  <li key={i} className="flex items-center gap-3 py-3">
                    {it.image && <img src={it.image} alt="" className="h-12 w-12 rounded-lg object-cover" />}
                    <div className="flex-1">
                      <p className="font-semibold">{it.name}</p>
                      {it.variationLabel && <p className="text-xs text-ink-mute">{it.variationLabel}</p>}
                      <p className="text-xs text-ink-mute">Qtde: {it.qty}</p>
                    </div>
                    <p className="font-semibold tabular-nums">{formatBRL(it.unitPrice * it.qty)}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl bg-bg-soft p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">Endereço</p>
              <p className="mt-1">{active.address.street}, {active.address.number}</p>
              <p className="text-xs text-ink-mute">
                {active.address.district}, {active.address.city}/{active.address.state} — {active.address.cep}
              </p>
            </div>

            {active.shipping.trackingCode ? (
              <TrackingSection code={active.shipping.trackingCode} />
            ) : (
              <div className="flex items-start gap-2 rounded-xl border border-dashed border-ink-line p-4 text-xs text-ink-mute">
                <Truck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Código de rastreio ainda não disponível. Ele aparece aqui assim que o pedido for enviado.</span>
              </div>
            )}

            <div className="space-y-1 border-t border-ink-line pt-3">
              <div className="flex justify-between"><span className="text-ink-mute">Subtotal</span><span>{formatBRL(active.subtotal)}</span></div>
              {active.coupon && (
                <div className="flex justify-between text-emerald-600"><span>Cupom {active.coupon.code}</span><span>-{formatBRL(active.coupon.discount)}</span></div>
              )}
              <div className="flex justify-between">
                <span className="text-ink-mute">Frete ({active.shipping.method})</span>
                <span>{active.shipping.price === 0 ? 'Grátis' : formatBRL(active.shipping.price)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-ink-line pt-2 font-bold">
                <span>Total</span>
                <span className="tabular-nums">{formatBRL(active.total)}</span>
              </div>
            </div>

            <div className="text-xs text-ink-mute">
              Pagamento: <span className="capitalize">{active.payment.method}</span>
              {active.payment.installments ? ` (${active.payment.installments}x)` : ''}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
