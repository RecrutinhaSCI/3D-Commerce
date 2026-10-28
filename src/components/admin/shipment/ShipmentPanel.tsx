import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FlaskConical, Package, Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/services/api';
import {
  shipmentLabelService,
  type ApiLabelAction,
  type ApiLabelConfirmation,
  type ApiLabelOverview,
  type PrepareLabelInput,
} from '@/services/shippingLabelsService';
import { formatBRL } from '@/utils/price';
import {
  ACTION_META,
  BUSY_TEXT,
  differenceInfo,
  formatCep,
  formatDateTime,
  formatDeadline,
  formatDifference,
  meErrorMessage,
  messageForCode,
  prepareFieldErrors,
  requestErrorMessage,
  STATUS_META,
  TONE_CLASSES,
  type Tone,
} from './labelUi';
import { PrepareLabelModal } from './PrepareLabelModal';
import { PurchaseConfirmModal } from './PurchaseConfirmModal';
import { ReasonModal } from './ReasonModal';

/** Enquanto uma operação está em andamento no backend, a tela se atualiza sozinha. */
export const IN_PROGRESS_POLL_MS = 3000;

type ModalKind = 'prepare' | 'purchase' | 'cancel' | 'discard' | 'note' | null;
type BusyKey = ApiLabelAction | 'PRINT' | 'LOAD';

const REASON_MODALS = {
  cancel: {
    title: 'Cancelar etiqueta',
    description: 'O Melhor Envio é consultado antes. Se permitido, a etiqueta é cancelada e o valor volta para a carteira (pode levar algumas horas).',
    confirmLabel: 'Cancelar etiqueta',
    danger: true,
  },
  discard: {
    title: 'Descartar preparação',
    description: 'Só é possível se o Melhor Envio confirmar que a etiqueta NÃO foi paga. Depois disso você pode preparar outra (ex.: trocar a caixa).',
    confirmLabel: 'Descartar preparação',
    danger: true,
  },
  note: {
    title: 'Adicionar nota',
    description: 'A nota fica só no histórico de auditoria. Ela não muda o status da etiqueta.',
    confirmLabel: 'Salvar nota',
    danger: false,
  },
} as const;

/**
 * Detalhe do pedido → "Expedição / Melhor Envio".
 *
 * Regras: os botões vêm SÓ de `availableActions` (backend); a compra envia
 * SÓ `labelId` + token; nenhum preço/estado é calculado aqui. O bloqueio de
 * clique duplo é conforto de tela — a proteção real é o backend.
 */
export function ShipmentPanel({ orderId }: { orderId: string }) {
  const [ov, setOv] = useState<ApiLabelOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyKey | null>(null);
  const busyRef = useRef(false);
  /** A última operação terminou em PRICE_CHANGED (o modal de compra reabre com o preço novo). */
  const priceChangedRef = useRef(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [confirmation, setConfirmation] = useState<ApiLabelConfirmation | null>(null);
  const [previousPrice, setPreviousPrice] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [modalError, setModalError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setOv(await shipmentLabelService.overview(orderId));
      setLoadError(null);
    } catch (err) {
      setLoadError(requestErrorMessage(err));
    }
  }, [orderId]);

  useEffect(() => {
    setOv(null);
    setConfirmation(null);
    setNotice(null);
    setWarnings([]);
    void load();
  }, [load]);

  // Recarregou no meio de uma compra/geração/cancelamento: acompanha pelo backend.
  const inProgress = Boolean(ov?.label?.inProgress);
  useEffect(() => {
    if (!inProgress || busy) return;
    const t = window.setTimeout(() => void load(), IN_PROGRESS_POLL_MS);
    return () => window.clearTimeout(t);
  }, [inProgress, busy, ov, load]);

  function apply(r: ApiLabelOverview) {
    setOv(r);
    if (r.confirmation) {
      setConfirmation(r.confirmation);
      setPreviousPrice(null);
    }
    if (r.warnings) setWarnings(r.warnings);
    if (r.error) {
      setNotice({ tone: r.error.requiresReconciliation || r.error.outcome === 'unknown' ? 'yellow' : 'red', text: meErrorMessage(r.error) });
    }
  }

  /** Uma operação por vez; erro sempre traduzido; estado sempre relido do backend em conflito. */
  async function run(key: BusyKey, fn: () => Promise<ApiLabelOverview>, opts: { inModal?: boolean } = {}): Promise<ApiLabelOverview | null> {
    if (busyRef.current) return null;
    busyRef.current = true;
    priceChangedRef.current = false;
    setBusy(key);
    setNotice(null);
    setModalError(null);
    setFieldErrors({});
    try {
      const r = await fn();
      apply(r);
      return r;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PRICE_CHANGED') {
        const d = err.details as { previousPrice?: number; confirmation?: ApiLabelConfirmation | null } | undefined;
        if (d?.confirmation) {
          priceChangedRef.current = true;
          setConfirmation(d.confirmation);
          setPreviousPrice(d.previousPrice ?? null);
          setModal('purchase');
        }
        setNotice({ tone: 'blue', text: messageForCode('PRICE_CHANGED') });
      } else if (opts.inModal) {
        setModalError(requestErrorMessage(err));
        setFieldErrors(prepareFieldErrors(err));
      } else {
        setNotice({ tone: err instanceof ApiError && err.status === 429 ? 'yellow' : 'red', text: requestErrorMessage(err) });
      }
      if (err instanceof ApiError && (err.status === 409 || err.status === 502)) await load();
      return null;
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const label = ov?.label ?? null;
  const actions = ov?.availableActions ?? [];
  const has = (a: ApiLabelAction) => actions.includes(a);

  async function openPurchase() {
    const valid = confirmation && label && label.pendingConfirmation && new Date(confirmation.expiresAt) > new Date();
    if (valid) return setModal('purchase');
    // Sem token em memória (ex.: página recarregada): o backend emite outro.
    const r = await run('REQUEST_CONFIRMATION', () => shipmentLabelService.requestConfirmation(orderId));
    if (r?.confirmation) setModal('purchase');
  }

  async function download(disposition: 'attachment' | 'inline') {
    const r = await run(disposition === 'inline' ? 'PRINT' : 'DOWNLOAD', async () => {
      const blob = await shipmentLabelService.file(orderId, disposition);
      const url = URL.createObjectURL(blob);
      if (disposition === 'attachment') {
        const a = document.createElement('a');
        a.href = url;
        a.download = `etiqueta-${label?.isTest ? 'TESTE-' : ''}${orderId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        const frame = document.createElement('iframe');
        frame.style.display = 'none';
        frame.src = url;
        frame.onload = () => frame.contentWindow?.print();
        document.body.appendChild(frame);
        window.setTimeout(() => frame.remove(), 60_000);
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return shipmentLabelService.overview(orderId);
    });
    if (r) setNotice({ tone: 'green', text: disposition === 'inline' ? 'Etiqueta aberta para impressão.' : 'Download da etiqueta iniciado.' });
  }

  async function onAction(a: ApiLabelAction) {
    switch (a) {
      case 'PREPARE':
        setModalError(null);
        setFieldErrors({});
        return setModal('prepare');
      case 'PURCHASE':
        return openPurchase();
      case 'REQUEST_CONFIRMATION': {
        const r = await run(a, () => shipmentLabelService.requestConfirmation(orderId));
        if (r?.confirmation && r.label?.availableActions.includes('PURCHASE')) setModal('purchase');
        return;
      }
      case 'GENERATE':
        return void run(a, () => shipmentLabelService.generate(orderId));
      case 'RECONCILE':
        return void run(a, () => shipmentLabelService.reconcile(orderId));
      case 'SYNC_STATUS':
        return void run(a, () => shipmentLabelService.sync(orderId));
      case 'CHECK_CANCELLABLE': {
        const r = await run(a, () => shipmentLabelService.cancellable(orderId));
        if (r && !r.error) {
          setNotice(
            r.cancellable
              ? { tone: 'green', text: 'O Melhor Envio permite cancelar esta etiqueta agora.' }
              : { tone: 'yellow', text: messageForCode('NOT_CANCELLABLE') },
          );
        }
        return;
      }
      case 'DOWNLOAD':
        return download('attachment');
      case 'CANCEL':
        return setModal('cancel');
      case 'DISCARD_UNPAID':
        return setModal('discard');
      case 'ADD_NOTE':
        return setModal('note');
    }
  }

  async function submitPrepare(input: PrepareLabelInput) {
    const r = await run('PREPARE', () => shipmentLabelService.prepare(orderId, input), { inModal: true });
    if (!r) return;
    if (r.confirmation && r.label?.availableActions.includes('PURCHASE')) setModal('purchase');
    else setModal(null);
  }

  async function confirmPurchase() {
    if (!label || !confirmation) return;
    const token = confirmation.token;
    const r = await run('PURCHASE', () => shipmentLabelService.purchase(orderId, label.id, token));
    // Usado (ou recusado): o token nunca é reaproveitado.
    setConfirmation((c) => (c?.token === token ? null : c));
    if (r) {
      setModal(null);
      if (!r.error) setNotice({ tone: 'green', text: r.label?.file.downloadable ? 'Etiqueta comprada e gerada.' : 'Etiqueta comprada. A geração pode levar alguns instantes — use “Atualizar status”.' });
    } else if (!priceChangedRef.current) {
      setModal(null); // erro sem nova confirmação: a mensagem fica no painel
    }
  }

  async function submitReason(reason: string, evidence?: string) {
    if (!label) return;
    const kind = modal;
    const fn =
      kind === 'cancel'
        ? () => shipmentLabelService.cancel(orderId, label.id, reason)
        : kind === 'discard'
          ? () => shipmentLabelService.discard(orderId, label.id, reason)
          : () => shipmentLabelService.addNote(orderId, label.id, reason, evidence);
    const r = await run(kind === 'cancel' ? 'CANCEL' : kind === 'discard' ? 'DISCARD_UNPAID' : 'ADD_NOTE', fn, { inModal: true });
    if (r) {
      setModal(null);
      if (!r.error) setNotice({ tone: 'green', text: kind === 'cancel' ? 'Etiqueta cancelada.' : kind === 'discard' ? 'Preparação descartada.' : 'Nota registrada.' });
    }
  }

  // ---------------------------------------------------------------------------

  if (!ov) {
    return (
      <section className="rounded-xl border border-ink-line p-4 text-sm" aria-label="Expedição / Melhor Envio">
        <h3 className="flex items-center gap-1.5 font-semibold"><Package className="h-4 w-4" /> Expedição / Melhor Envio</h3>
        {loadError ? (
          <div className="mt-2 space-y-2">
            <p role="alert" className="text-rose-700">{loadError}</p>
            <Button size="sm" variant="secondary" onClick={() => void load()}>Tentar de novo</Button>
          </div>
        ) : (
          <p className="mt-2 text-ink-mute">Carregando…</p>
        )}
      </section>
    );
  }

  const meta = STATUS_META[label?.status ?? 'NONE'];
  const isTest = label ? label.isTest : ov.config.isTest;
  const values = label?.values;
  const customer = values?.customerShippingValue ?? ov.order.customerShippingValue;
  const diff = differenceInfo(values?.difference ?? null);
  const busyText = busy ? BUSY_TEXT[busy] : label?.inProgress ? 'Operação em andamento no Melhor Envio… a tela se atualiza sozinha.' : null;
  const buttons = ACTION_META.filter((m) => has(m.action));
  const pkg = label?.package;
  const dates = label
    ? ([
        ['Preparada', label.dates.preparedAt],
        ['Comprada', label.dates.purchasedAt],
        ['Gerada', label.dates.generatedAt],
        ['Postada', label.dates.postedAt],
        ['Entregue', label.dates.deliveredAt],
        ['Cancelada', label.dates.canceledAt],
        ['Última consulta', label.dates.lastSyncedAt],
      ] as const).filter(([, v]) => v)
    : [];

  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-ink-line p-4 text-sm" aria-label="Expedição / Melhor Envio" data-testid="shipment-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-semibold"><Package className="h-4 w-4" /> Expedição / Melhor Envio</h3>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASSES[meta.tone]}`} data-testid="label-status" data-tone={meta.tone}>
          {meta.label}
        </span>
      </div>

      {isTest ? (
        <p className="flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800" data-testid="sandbox-banner">
          <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Ambiente de teste — nenhuma postagem real será gerada.
        </p>
      ) : (
        <p className="text-xs font-semibold text-ink-mute" data-testid="env-production">Ambiente: Produção</p>
      )}
      {!ov.config.enabled && <p className="rounded-xl bg-bg-soft p-3 text-xs text-ink-soft">Etiquetas do Melhor Envio estão desligadas no servidor.</p>}
      {ov.config.enabled && !ov.config.purchaseAllowed && <p className="rounded-xl bg-bg-soft p-3 text-xs text-ink-soft">{messageForCode('LABELS_PRODUCTION_BLOCKED')}</p>}

      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        <Info term="Serviço" value={label?.service.name ?? ov.order.shippingServiceName ?? ov.order.shippingMethod ?? '—'} />
        <Info term="Transportadora" value={label?.carrier ?? ov.order.shippingCarrier ?? '—'} />
        <Info term="CEP de destino" value={formatCep(ov.order.destinationCep)} />
        <Info term="Prazo estimado" value={formatDeadline(ov.order.deadlineDays)} />
      </dl>

      <dl className="space-y-1.5 rounded-xl bg-bg-soft p-3" data-testid="label-values">
        <Info term="Frete cobrado do cliente" value={customer === null ? '—' : formatBRL(customer)} />
        <Info term={values?.paidPrice !== null && values?.paidPrice !== undefined ? 'Preço cotado' : 'Custo atual da etiqueta'} value={values?.quotedPrice == null ? '—' : formatBRL(values.quotedPrice)} />
        {values?.paidPrice != null && <Info term="Preço pago" value={formatBRL(values.paidPrice)} strong />}
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-mute">Diferença</dt>
          <dd className={`min-w-0 break-words text-right font-bold tabular-nums ${diff.tone === 'red' ? 'text-rose-700' : diff.tone === 'green' ? 'text-emerald-700' : ''}`} data-testid="label-difference">
            {formatDifference(values?.difference ?? null)}
          </dd>
        </div>
        {values?.difference != null && <p className="text-xs text-ink-mute">{diff.text}</p>}
      </dl>

      {label && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          <Info term="Caixa" value={pkg ? `${num(pkg.weightKg)} kg · ${num(pkg.widthCm)}×${num(pkg.heightCm)}×${num(pkg.lengthCm)} cm` : '—'} />
          <Info term="Fiscal" value={label.fiscal.mode === 'NFE' ? `NF-e (…${label.fiscal.nfeKeyEnd ?? ''})` : 'Declaração de conteúdo'} />
          <Info term="Rastreio da etiqueta" value={label.tracking.code ?? '—'} mono />
          {dates.map(([t, v]) => <Info key={t} term={t} value={formatDateTime(v)} />)}
        </dl>
      )}
      {label?.tracking.code && label.tracking.orderSync === 'SANDBOX_NEVER' && (
        <p className="text-xs text-ink-mute">Rastreio de teste: não é copiado para o pedido nem enviado ao cliente.</p>
      )}
      {label?.status === 'LABEL_READY' && !label.file.downloadable && (
        <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800" data-testid="file-pending">Etiqueta ainda sendo gerada pelo Melhor Envio. Use “Atualizar status” em instantes.</p>
      )}
      {label?.file.downloadable && label.file.sandboxPrintLimited && (
        <p className="text-xs text-ink-mute">No Sandbox o Melhor Envio pode não gerar o PDF de etiquetas dos Correios — é limitação do ambiente de teste.</p>
      )}
      {label?.requiresReconciliation && (
        <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 p-3 text-xs text-amber-800" data-testid="needs-reconciliation">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {messageForCode('NEEDS_RECONCILIATION')} Nada é comprado de novo automaticamente.
        </p>
      )}
      {label?.lastError && !label.requiresReconciliation && (
        <p className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700" data-testid="last-error">Último erro: {messageForCode(label.lastError.code)}</p>
      )}
      {label?.cancelReason && <p className="text-xs text-ink-mute">Motivo: {label.cancelReason}</p>}

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {busyText && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800" role="status" data-testid="busy">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" /> {busyText}
        </p>
      )}
      {notice && (
        <p role="alert" className={`rounded-xl border p-3 text-xs ${TONE_CLASSES[notice.tone]}`} data-testid="notice">{notice.text}</p>
      )}

      {buttons.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap" data-testid="label-actions">
          {buttons.map((m) => (
            <Button
              key={m.action}
              size="sm"
              variant={m.danger ? 'secondary' : m.primary ? 'primary' : 'secondary'}
              className={m.danger ? '!text-rose-600' : undefined}
              disabled={busy !== null || inProgress}
              loading={busy === m.action}
              data-action={m.action}
              onClick={() => void onAction(m.action)}
            >
              {m.label}
            </Button>
          ))}
          {has('DOWNLOAD') && (
            <Button size="sm" variant="secondary" disabled={busy !== null || inProgress} loading={busy === 'PRINT'} data-action="PRINT" onClick={() => void download('inline')}>
              <Printer className="h-3.5 w-3.5" /> Imprimir etiqueta
            </Button>
          )}
        </div>
      )}

      {ov.history.length > 0 && (
        <details className="text-xs text-ink-mute">
          <summary className="cursor-pointer">Etiquetas anteriores ({ov.history.length})</summary>
          <ul className="mt-2 space-y-1">
            {ov.history.map((h) => (
              <li key={h.id}>
                {STATUS_META[h.status].label} · {formatDateTime(h.canceledAt ?? h.createdAt)}
                {h.isTest ? ' · teste' : ''}
                {h.cancelReason ? ` · ${h.cancelReason}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      <PrepareLabelModal
        open={modal === 'prepare'}
        overview={ov}
        busy={busy === 'PREPARE'}
        fieldErrors={fieldErrors}
        error={modalError}
        onClose={() => setModal(null)}
        onSubmit={(input) => void submitPrepare(input)}
      />
      {label && confirmation && (
        <PurchaseConfirmModal
          open={modal === 'purchase'}
          label={label}
          confirmation={confirmation}
          previousPrice={previousPrice}
          busy={busy === 'PURCHASE'}
          onClose={() => setModal(null)}
          onConfirm={() => void confirmPurchase()}
        />
      )}
      {(modal === 'cancel' || modal === 'discard' || modal === 'note') && (
        <ReasonModal
          open
          {...REASON_MODALS[modal]}
          withEvidence={modal === 'note'}
          busy={busy !== null}
          error={modalError}
          onClose={() => setModal(null)}
          onSubmit={(reason, evidence) => void submitReason(reason, evidence)}
        />
      )}
    </section>
  );
}

const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

function Info({ term, value, strong, mono }: { term: string; value: string; strong?: boolean; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ink-mute">{term}</dt>
      <dd className={`min-w-0 break-words text-right tabular-nums ${strong ? 'font-bold' : 'font-semibold'} ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}
