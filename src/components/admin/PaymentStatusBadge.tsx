import type { PaymentStatus } from '@/types';

// O StatusBadge existente é tipado para OrderStatus (status logístico do pedido).
// O status de pagamento é outro enum, então usamos um badge irmão com o mesmo
// visual, sem forçar tipos incompatíveis.
const tones: Record<PaymentStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-rose-100 text-rose-700',
  REFUNDED: 'bg-violet-100 text-violet-700',
  CANCELED: 'bg-ink/10 text-ink-mute',
};

const labels: Record<PaymentStatus, string> = {
  PENDING: 'Aguardando pagamento',
  PAID: 'Pago',
  FAILED: 'Falhou',
  REFUNDED: 'Reembolsado',
  CANCELED: 'Cancelado',
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold ${tones[status]}`}>
      {labels[status]}
    </span>
  );
}

export { labels as paymentStatusLabels };
