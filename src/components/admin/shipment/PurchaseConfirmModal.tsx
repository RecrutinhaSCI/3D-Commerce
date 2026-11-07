import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { ApiLabelConfirmation, ApiShipmentLabel } from '@/services/shippingLabelsService';
import { formatBRL } from '@/utils/price';
import { differenceInfo, formatDateTime, formatDifference, TONE_CLASSES } from './labelUi';

interface Props {
  open: boolean;
  label: ApiShipmentLabel;
  /** Valores vindos do BACKEND na confirmação — o front não calcula preço. */
  confirmation: ApiLabelConfirmation;
  /** Preço anterior quando o backend respondeu PRICE_CHANGED. */
  previousPrice: number | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function PurchaseConfirmModal({ open, label, confirmation, previousPrice, busy, onClose, onConfirm }: Props) {
  const diff = differenceInfo(confirmation.difference);
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Confirmar compra da etiqueta">
      <div className="space-y-4" data-testid="purchase-modal">
        {label.isTest && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
            Ambiente de teste — nenhuma postagem real será gerada.
          </p>
        )}
        {previousPrice !== null && (
          <p role="alert" className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
            O preço mudou de <strong>{formatBRL(previousPrice)}</strong> para <strong>{formatBRL(confirmation.price)}</strong>. Confira antes de comprar.
          </p>
        )}

        <dl className="space-y-2 text-sm">
          <Row term="Serviço" value={label.service.name ?? '—'} />
          <Row term="Transportadora" value={label.carrier ?? '—'} />
          <Row term="Frete cobrado do cliente" value={formatBRL(confirmation.customerShippingValue)} testId="confirm-customer" />
          <Row term="Custo atual da etiqueta" value={formatBRL(confirmation.price)} testId="confirm-price" strong />
        </dl>

        <div className={`rounded-xl border p-3 ${TONE_CLASSES[diff.tone]}`} data-testid="confirm-difference" data-tone={diff.tone}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">Diferença</span>
            <span className="text-lg font-bold tabular-nums">{formatDifference(confirmation.difference)}</span>
          </div>
          <p className="mt-1 text-xs">{diff.text}</p>
        </div>

        <p className="text-xs text-ink-mute">
          O valor é debitado da carteira do Melhor Envio. Confirmação válida até {formatDateTime(confirmation.expiresAt)}.
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button loading={busy} onClick={onConfirm} data-testid="confirm-purchase">Comprar e gerar etiqueta</Button>
        </div>
      </div>
    </Modal>
  );
}

function Row({ term, value, strong, testId }: { term: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-mute">{term}</dt>
      <dd className={`text-right tabular-nums ${strong ? 'font-bold' : 'font-semibold'}`} data-testid={testId}>{value}</dd>
    </div>
  );
}
