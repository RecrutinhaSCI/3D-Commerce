import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Label, Textarea } from '@/components/ui/Input';

interface Props {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  withEvidence?: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (reason: string, evidence?: string) => void;
}

/** Cancelar / descartar / nota: motivo obrigatório (vai para a auditoria). */
export function ReasonModal({ open, title, description, confirmLabel, danger, withEvidence, busy, error, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  useEffect(() => {
    if (open) {
      setReason('');
      setEvidence('');
    }
  }, [open]);
  const valid = reason.trim().length >= 5;

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(reason.trim(), withEvidence && evidence.trim() ? evidence.trim() : undefined);
        }}
      >
        <p className="text-sm text-ink-soft">{description}</p>
        <div>
          <Label>Motivo</Label>
          <Textarea name="reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
          <p className="mt-1 text-xs text-ink-mute">Mínimo de 5 caracteres. Não inclua CPF, e-mail ou telefone.</p>
        </div>
        {withEvidence && (
          <div>
            <Label>Evidência (opcional)</Label>
            <Textarea name="evidence" rows={2} maxLength={300} value={evidence} onChange={(e) => setEvidence(e.target.value)} disabled={busy} />
          </div>
        )}
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Voltar</Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={busy} disabled={!valid}>{confirmLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}
