import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { formatBRL } from '@/utils/price';
import { StatusBadge, statusLabels } from '@/components/admin/StatusBadge';
import { PaymentStatusBadge, paymentStatusLabels } from '@/components/admin/PaymentStatusBadge';
import { Drawer } from '@/components/ui/Drawer';
import { Modal } from '@/components/ui/Modal';
import { Input, Label, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { AlertTriangle, RefreshCw, Truck } from 'lucide-react';
import { ApiError } from '@/services/api';
import type { Order, OrderStatus, PaymentStatus } from '@/types';
import { useSEO } from '@/utils/seo';

/** Marcadores de alerta gravados nas notas pelo backend (revisão do admin). */
const ALERT_MARKERS = ['[REVISAR ESTOQUE]', '[PAGAMENTO DUPLICADO]', '[CONFERIR VALOR]', '[ESTORNO MANUAL]'];
const hasAlert = (o: Order) => !!o.notes && ALERT_MARKERS.some((m) => o.notes!.includes(m));

const paymentMethodLabel: Record<Order['payment']['method'], string> = {
  pix: 'Pix',
  credito: 'Cartão de crédito',
  boleto: 'Boleto',
};

function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

export default function Orders() {
  useSEO('Admin Pedidos');
  const { orders, updateOrderStatus, setTrackingCode, cancelOrder, refreshOrders } = useAdminDataStore();
  const [params, setParams] = useSearchParams();
  const initialStatus = (params.get('status') ?? 'all') as 'all' | OrderStatus;
  const [filter, setFilter] = useState<'all' | OrderStatus>(initialStatus);
  const [active, setActive] = useState<Order | null>(null);
  const [trackingInput, setTrackingInput] = useState('');
  const [savingTracking, setSavingTracking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const couponParam = params.get('cupom');
  useEffect(() => {
    const s = params.get('status') as OrderStatus | null;
    if (s) setFilter(s);
  }, [params]);
  useEffect(() => {
    setTrackingInput(active?.shipping.trackingCode ?? '');
  }, [active]);

  const filtered = orders.filter((o) => {
    if (filter !== 'all' && o.status !== filter) return false;
    if (couponParam && o.coupon?.code !== couponParam) return false;
    return true;
  });

  function clearCouponFilter() {
    const next = new URLSearchParams(params);
    next.delete('cupom');
    setParams(next, { replace: true });
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshOrders();
      toast.success('Pedidos atualizados');
    } catch (err) {
      toast.error(errorMessage(err, 'Não foi possível atualizar os pedidos.'));
    } finally {
      setRefreshing(false);
    }
  }

  async function changeStatus(patch: { status?: OrderStatus; paymentStatus?: PaymentStatus }) {
    if (!active) return;
    setSavingStatus(true);
    try {
      const updated = await updateOrderStatus(active.id, patch);
      setActive(updated);
      toast.success(
        patch.status
          ? `Status: ${statusLabels[updated.status]}`
          : `Pagamento: ${updated.paymentStatus ? paymentStatusLabels[updated.paymentStatus] : '—'}`,
      );
    } catch (err) {
      toast.error(errorMessage(err, 'Não foi possível alterar o status.'));
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleCancel() {
    if (!active) return;
    setCanceling(true);
    try {
      const { order, result } = await cancelOrder(active.id);
      setActive(order);
      toast.success(result === 'refunded' ? 'Pedido cancelado e valor estornado.' : 'Pedido cancelado.');
      setConfirmCancel(false);
    } catch (err) {
      toast.error(errorMessage(err, 'Não foi possível cancelar o pedido.'));
    } finally {
      setCanceling(false);
    }
  }

  const activeIsPaid = active?.paymentStatus === 'PAID';
  const activeCanceled = active?.status === 'cancelado';

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Operação</p>
          <h1 className="section-title">Pedidos</h1>
          <p className="mt-1 text-sm text-ink-mute">{filtered.length} pedido(s)</p>
          {couponParam && (
            <button
              onClick={clearCouponFilter}
              className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              Cupom: {couponParam} · limpar ✕
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" loading={refreshing} onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
          <Select value={filter} onChange={(e) => setFilter(e.target.value as 'all' | OrderStatus)} className="max-w-[220px]">
            <option value="all">Todos os status</option>
            {(Object.keys(statusLabels) as OrderStatus[]).map((s) => (
              <option key={s} value={s}>{statusLabels[s]}</option>
            ))}
          </Select>
        </div>
      </header>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-soft text-left text-xs uppercase tracking-wider text-ink-mute">
            <tr>
              <th className="px-4 py-3">Pedido</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Cupom</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Pagamento</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-line">
            {filtered.map((o) => (
              <tr key={o.id} className="hover:bg-bg-soft/50">
                <td className="px-4 py-3 font-semibold">
                  <span className="inline-flex items-center gap-1.5">
                    {hasAlert(o) && (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-label="Pedido precisa de revisão" />
                    )}
                    {o.id}
                  </span>
                </td>
                <td className="px-4 py-3">{o.customer.name}</td>
                <td className="px-4 py-3 text-ink-mute">{new Date(o.createdAt).toLocaleDateString('pt-BR')}</td>
                <td className="px-4 py-3">
                  {o.coupon ? (
                    <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-700">
                      {o.coupon.code}
                    </span>
                  ) : (
                    <span className="text-ink-mute">—</span>
                  )}
                </td>
                <td className="px-4 py-3">{formatBRL(o.total)}</td>
                <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                <td className="px-4 py-3">
                  {o.paymentStatus ? <PaymentStatusBadge status={o.paymentStatus} /> : <span className="text-ink-mute">—</span>}
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => setActive(o)} className="text-xs font-semibold text-ink hover:underline">Detalhes →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Drawer open={!!active} onClose={() => setActive(null)} title={active?.id ?? 'Pedido'} width="w-full sm:max-w-lg">
        {active && (
          <div className="space-y-5 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={active.status} />
              {active.paymentStatus && <PaymentStatusBadge status={active.paymentStatus} />}
            </div>

            {active.notes && (
              <div className={`rounded-xl p-4 text-sm ${hasAlert(active) ? 'bg-amber-50 text-amber-800' : 'bg-bg-soft'}`}>
                <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
                  {hasAlert(active) && <AlertTriangle className="h-3.5 w-3.5" />} Observações
                </p>
                <p className="whitespace-pre-line">{active.notes}</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Status do pedido</Label>
                <Select
                  value={active.status}
                  disabled={savingStatus || activeCanceled}
                  onChange={(e) => changeStatus({ status: e.target.value as OrderStatus })}
                >
                  {(Object.keys(statusLabels) as OrderStatus[]).map((s) => (
                    <option key={s} value={s}>{statusLabels[s]}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Pagamento</Label>
                <Select
                  value={active.paymentStatus ?? 'PENDING'}
                  disabled={savingStatus || activeCanceled}
                  onChange={(e) => changeStatus({ paymentStatus: e.target.value as PaymentStatus })}
                >
                  {(Object.keys(paymentStatusLabels) as PaymentStatus[]).map((s) => (
                    <option key={s} value={s}>{paymentStatusLabels[s]}</option>
                  ))}
                </Select>
              </div>
            </div>
            <p className="-mt-3 text-xs text-ink-mute">
              Marcar como “Pago” baixa o estoque e confirma o pedido. Use só para pagamentos feitos fora do site.
            </p>

            <div className="rounded-xl bg-bg-soft p-4 text-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">Pagamento</p>
              <p className="mt-1">{paymentMethodLabel[active.payment.method]}</p>
              {active.mpOrderId && (
                <p className="text-xs text-ink-mute">
                  Mercado Pago: <span className="font-mono">{active.mpOrderId}</span>
                </p>
              )}
            </div>

            <div className="rounded-xl bg-bg-soft p-4 text-sm">
              <p className="font-semibold">{active.customer.name}</p>
              <p className="text-ink-mute">{active.customer.email}</p>
              <p className="text-ink-mute">{active.customer.phone}</p>
            </div>
            <div className="rounded-xl bg-bg-soft p-4 text-sm">
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">Endereço</p>
              <p>{active.address.street}, {active.address.number}</p>
              <p className="text-ink-mute">{active.address.district}, {active.address.city}/{active.address.state} — {active.address.cep}</p>
            </div>

            <div className="rounded-xl border border-ink-line p-4 text-sm">
              <Label className="flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5" /> Código de rastreio
              </Label>
              <div className="flex gap-2">
                <Input
                  value={trackingInput}
                  onChange={(e) => setTrackingInput(e.target.value)}
                  placeholder="Ex.: AA123456789BR"
                />
                <Button
                  size="sm"
                  loading={savingTracking}
                  onClick={async () => {
                    const code = trackingInput.trim();
                    setSavingTracking(true);
                    try {
                      await setTrackingCode(active.id, code);
                      setActive({ ...active, shipping: { ...active.shipping, trackingCode: code || undefined } });
                      toast.success(code ? 'Código de rastreio salvo' : 'Código de rastreio removido');
                    } catch (err) {
                      toast.error(errorMessage(err, 'Não foi possível salvar o código de rastreio.'));
                    } finally {
                      setSavingTracking(false);
                    }
                  }}
                >
                  Salvar
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-ink-mute">
                O cliente vê e rastreia por este código em “Meus pedidos”.
              </p>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">Itens</p>
              <ul className="mt-2 space-y-2 text-sm">
                {active.items.map((it, i) => (
                  <li key={i} className="flex justify-between">
                    <span>{it.qty}x {it.name}</span>
                    <span className="font-semibold">{formatBRL(it.unitPrice * it.qty)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-1 border-t border-ink-line pt-3 text-sm">
              <div className="flex justify-between"><span className="text-ink-mute">Subtotal</span><span>{formatBRL(active.subtotal)}</span></div>
              {active.coupon && <div className="flex justify-between text-emerald-600"><span>Cupom {active.coupon.code}</span><span>-{formatBRL(active.coupon.discount)}</span></div>}
              <div className="flex justify-between"><span className="text-ink-mute">Frete ({active.shipping.method})</span><span>{active.shipping.price === 0 ? 'Grátis' : formatBRL(active.shipping.price)}</span></div>
              {!!active.paymentDiscount && (
                <div className="flex justify-between text-emerald-600"><span>Desconto Pix</span><span>-{formatBRL(active.paymentDiscount)}</span></div>
              )}
              <div className="flex justify-between border-t border-ink-line pt-1 font-bold"><span>Total</span><span>{formatBRL(active.total)}</span></div>
            </div>

            {!activeCanceled && (
              <div className="border-t border-ink-line pt-4">
                <Button variant="secondary" fullWidth onClick={() => setConfirmCancel(true)} className="!text-rose-600">
                  {activeIsPaid ? 'Estornar e cancelar pedido' : 'Cancelar pedido'}
                </Button>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal
        open={confirmCancel}
        onClose={() => !canceling && setConfirmCancel(false)}
        title={activeIsPaid ? 'Estornar e cancelar?' : 'Cancelar pedido?'}
      >
        <h2 className="pr-8 text-lg font-bold">{activeIsPaid ? 'Estornar e cancelar?' : 'Cancelar pedido?'}</h2>
        <p className="mt-2 text-sm text-ink-soft">
          {activeIsPaid
            ? active?.mpOrderId
              ? `O valor de ${formatBRL(active.total)} será estornado ao cliente pelo Mercado Pago. O estoque volta e o cupom é liberado.`
              : 'Este pagamento foi feito fora do site: o pedido é cancelado, mas você precisa devolver o valor ao cliente manualmente.'
            : 'A cobrança em aberto (Pix/boleto) é cancelada, o estoque e o cupom são liberados.'}{' '}
          O cliente recebe um e-mail. Esta ação não pode ser desfeita.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" disabled={canceling} onClick={() => setConfirmCancel(false)}>
            Voltar
          </Button>
          <Button loading={canceling} onClick={handleCancel} className="!bg-rose-600 hover:!bg-rose-700">
            {activeIsPaid ? 'Estornar e cancelar' : 'Cancelar pedido'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
