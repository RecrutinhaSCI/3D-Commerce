import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import type { ApiLabelOverview, PrepareLabelInput } from '@/services/shippingLabelsService';

interface Props {
  open: boolean;
  overview: ApiLabelOverview;
  busy: boolean;
  /** Erros de campo do 422 do backend (zod). */
  fieldErrors: Record<string, string>;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: PrepareLabelInput) => void;
}

type Dim = 'weightKg' | 'widthCm' | 'heightCm' | 'lengthCm';
const DIMS: Array<{ key: Dim; label: string; unit: string; step: string }> = [
  { key: 'weightKg', label: 'Peso', unit: 'kg', step: '0.001' },
  { key: 'widthCm', label: 'Largura', unit: 'cm', step: '0.1' },
  { key: 'heightCm', label: 'Altura', unit: 'cm', step: '0.1' },
  { key: 'lengthCm', label: 'Comprimento', unit: 'cm', step: '0.1' },
];

const toNum = (v: string) => Number(v.replace(',', '.'));
const str = (n: number | undefined | null) => (typeof n === 'number' && Number.isFinite(n) ? String(n) : '');

/**
 * Caixa real + modalidade fiscal. Pré-preenche com a sugestão dos produtos
 * (ou a caixa da etiqueta anterior). Avisos NÃO bloqueiam; quem valida de
 * verdade é o backend (e o Melhor Envio).
 */
export function PrepareLabelModal({ open, overview, busy, fieldErrors, error, onClose, onSubmit }: Props) {
  const suggestion = overview.order.packageSuggestion;
  const previous = overview.label?.package ?? null;
  const [dims, setDims] = useState<Record<Dim, string>>({ weightKg: '', widthCm: '', heightCm: '', lengthCm: '' });
  const [mode, setMode] = useState<'DECLARATION' | 'NFE'>('DECLARATION');
  const [nfeKey, setNfeKey] = useState('');
  const [document, setDocument] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const base = previous ?? suggestion?.package ?? null;
    setDims({ weightKg: str(base?.weightKg), widthCm: str(base?.widthCm), heightCm: str(base?.heightCm), lengthCm: str(base?.lengthCm) });
    setMode(overview.label?.fiscal.mode ?? 'DECLARATION');
    setNfeKey('');
    setDocument('');
    setLocalError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sender = overview.order.sender;
  const warnings: string[] = [];
  if (suggestion && !suggestion.package && suggestion.itemsMissingData > 0) {
    warnings.push(`${suggestion.itemsMissingData} item(ns) sem peso/medidas no cadastro: informe a caixa manualmente.`);
  } else if (suggestion?.package && !previous) {
    warnings.push('Caixa sugerida pelos produtos. Confira com a embalagem real antes de continuar.');
  }
  if (sender?.issues.length) warnings.push(...sender.issues);
  if (mode === 'NFE' && sender && !sender.nfe) warnings.push('Remetente sem inscrição estadual: o envio com NF-e será recusado.');
  if (overview.order.recipientDocumentMissing) warnings.push('Pedido sem CPF/CNPJ do destinatário: o Melhor Envio pode exigir o documento.');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const values = Object.fromEntries(DIMS.map(({ key }) => [key, toNum(dims[key])])) as Record<Dim, number>;
    if (DIMS.some(({ key }) => !(values[key] > 0))) return setLocalError('Informe peso e medidas maiores que zero.');
    const key = nfeKey.replace(/\D/g, '');
    if (mode === 'NFE' && key.length !== 44) return setLocalError('A chave da NF-e tem 44 dígitos.');
    setLocalError(null);
    const doc = document.replace(/\D/g, '');
    onSubmit({
      package: { weightKg: values.weightKg, heightCm: values.heightCm, widthCm: values.widthCm, lengthCm: values.lengthCm },
      fiscal: mode === 'NFE' ? { mode: 'NFE', nfeKey: key } : { mode: 'DECLARATION' },
      ...(overview.order.recipientDocumentMissing && doc ? { recipientDocument: doc } : {}),
    });
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Preparar etiqueta" maxWidth="max-w-lg">
      <form onSubmit={submit} className="space-y-4" data-testid="prepare-form">
        <fieldset disabled={busy} className="space-y-4">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-ink-mute">Caixa usada</p>
            <div className="grid grid-cols-2 gap-3">
              {DIMS.map(({ key, label, unit, step }) => (
                <div key={key} className="min-w-0">
                  <Label>{label} ({unit})</Label>
                  <Input
                    name={key}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step={step}
                    value={dims[key]}
                    error={fieldErrors[key]}
                    onChange={(e) => setDims((d) => ({ ...d, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-ink-mute">Modalidade fiscal</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {(['DECLARATION', 'NFE'] as const).map((m) => (
                <label key={m} className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm ${mode === m ? 'border-ink' : 'border-ink-line'}`}>
                  <input type="radio" name="fiscalMode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                  {m === 'DECLARATION' ? 'Declaração de conteúdo' : 'NF-e'}
                </label>
              ))}
            </div>
            {mode === 'NFE' && (
              <div className="mt-3">
                <Label>Chave da NF-e (44 dígitos)</Label>
                <Input name="nfeKey" inputMode="numeric" value={nfeKey} error={fieldErrors.nfeKey} onChange={(e) => setNfeKey(e.target.value)} />
              </div>
            )}
          </div>

          {overview.order.recipientDocumentMissing && (
            <div>
              <Label>CPF/CNPJ do destinatário (opcional)</Label>
              <Input name="recipientDocument" inputMode="numeric" value={document} onChange={(e) => setDocument(e.target.value)} />
            </div>
          )}
        </fieldset>

        {warnings.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-amber-50 p-3 text-xs text-amber-800" data-testid="prepare-warnings">
            {warnings.map((w) => (
              <li key={w} className="flex gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{w}</span>
              </li>
            ))}
          </ul>
        )}
        {(localError || error) && (
          <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{localError ?? error}</p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy}>Preparar e consultar preço</Button>
        </div>
      </form>
    </Modal>
  );
}
