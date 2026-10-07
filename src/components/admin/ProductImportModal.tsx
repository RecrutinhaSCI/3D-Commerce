import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, FileUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { parseProductsXlsx, type ParsedProductRow, type ParseResult } from '@/utils/productExcel';
import { productService, type BulkImportReport, type BulkImportRow } from '@/services/productService';
import { ApiError } from '@/services/api';

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void; // refresh após gravar
}

export function ProductImportModal({ open, onClose, onDone }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<BulkImportReport | null>(null);

  function reset() {
    setResult(null);
    setReport(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function close() {
    reset();
    onClose();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setResult(null);
    setReport(null);
    try {
      const parsed = await parseProductsXlsx(file);
      if (parsed.rows.length === 0) {
        toast.error('A planilha não tem linhas de produto.');
      }
      setResult(parsed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao ler o arquivo.');
    } finally {
      setParsing(false);
    }
  }

  async function confirmImport() {
    if (!result) return;
    const valid = result.rows.filter((r) => r.errors.length === 0);
    if (valid.length === 0) {
      toast.error('Nenhuma linha válida para importar.');
      return;
    }
    setImporting(true);
    try {
      // R19-A: uma única chamada. Backend decide create/update/conflict lendo
      // o banco real (não o cache do store). Só enviamos chaves DEFINIDAS —
      // vazio = não altera lá.
      const rows: BulkImportRow[] = valid.map((r) => stripUndefined({ line: r.line, ...r.data }));
      const rep = await productService.bulkImport(rows);
      setReport(rep);
      onDone();
      toast.success(
        `Importação: ${rep.summary.created} criados, ${rep.summary.updated} atualizados, ` +
        `${rep.summary.conflicts} conflito(s), ${rep.summary.skipped} ignorado(s).`,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao enviar a importação.');
    } finally {
      setImporting(false);
    }
  }

  /** Remove chaves undefined — importante para o payload JSON. */
  function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
    return out as T;
  }

  const rowsWithErrors: ParsedProductRow[] = result ? result.rows.filter((r) => r.errors.length > 0) : [];

  return (
    <Modal open={open} onClose={close} title="Importar produtos (Excel)" maxWidth="max-w-2xl">
      <div className="space-y-4">
        {!result && !report && (
          <div className="rounded-xl border border-dashed border-ink-line p-6 text-center">
            <FileUp className="mx-auto h-8 w-8 text-ink-mute" />
            <p className="mt-3 text-sm text-ink-soft">Selecione um arquivo <b>.xlsx</b> (máx. 2 MB).</p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFile}
              className="mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-2 file:text-bg"
            />
            {parsing && <p className="mt-3 text-xs text-ink-mute">Lendo planilha...</p>}
          </div>
        )}

        {result && !report && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-bg-soft p-3">
                <p className="text-lg font-bold">{result.rows.length}</p>
                <p className="text-[11px] uppercase tracking-wide text-ink-mute">Linhas</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3">
                <p className="text-lg font-bold text-emerald-700">{result.validCount}</p>
                <p className="text-[11px] uppercase tracking-wide text-emerald-700">Válidas</p>
              </div>
              <div className="rounded-lg bg-rose-50 p-3">
                <p className="text-lg font-bold text-rose-600">{result.errorCount}</p>
                <p className="text-[11px] uppercase tracking-wide text-rose-600">Com erro</p>
              </div>
            </div>

            {rowsWithErrors.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-ink-line text-xs">
                {rowsWithErrors.map((r) => (
                  <div key={r.line} className="flex items-start gap-2 border-b border-ink-line/50 px-3 py-2 last:border-0">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span>
                      <b>Linha {r.line}</b> ({r.data.name || 'sem nome'}): {r.errors.join(' ')}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-ink-mute">
              Matching seguro: <b>ID</b> → <b>SKU</b> → <b>slug explícito</b>. Sem esses,
              linha vira <b>criação</b> — ou <b>conflito</b> se houver produto com nome parecido.
              Nunca sobrescrevemos produto por colisão de nome. Célula vazia = <b>não alterar</b>.
              A coluna <b>imagem</b> (URL) atualiza só a mídia principal — galeria e vídeos são preservados.
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={reset}>Trocar arquivo</Button>
              <Button onClick={confirmImport} loading={importing} disabled={result.validCount === 0}>
                Importar {result.validCount} produto(s)
              </Button>
            </div>
          </div>
        )}

        {report && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" /> <span className="font-semibold">Importação concluída</span>
            </div>
            <div className="grid grid-cols-4 gap-3 text-center">
              <div className="rounded-lg bg-emerald-50 p-3"><p className="text-lg font-bold text-emerald-700">{report.summary.created}</p><p className="text-[11px] uppercase text-emerald-700">Criados</p></div>
              <div className="rounded-lg bg-sky-50 p-3"><p className="text-lg font-bold text-sky-700">{report.summary.updated}</p><p className="text-[11px] uppercase text-sky-700">Atualizados</p></div>
              <div className="rounded-lg bg-amber-50 p-3"><p className="text-lg font-bold text-amber-700">{report.summary.conflicts}</p><p className="text-[11px] uppercase text-amber-700">Conflitos</p></div>
              <div className="rounded-lg bg-ink/5 p-3"><p className="text-lg font-bold text-ink-mute">{report.summary.skipped}</p><p className="text-[11px] uppercase text-ink-mute">Ignorados</p></div>
            </div>
            {/* R19-C — resumo curto de imagens principais afetadas (não é bucket novo). */}
            {(() => {
              const withImg = [...report.created, ...report.updated].filter((i) => i.imageUpdated).length;
              return withImg > 0 ? (
                <p className="text-xs text-ink-mute">
                  {withImg} linha(s) também alteraram a <b>imagem principal</b>.
                </p>
              ) : null;
            })()}

            {(report.conflicts.length > 0 || report.skipped.length > 0) && (
              <div className="max-h-52 overflow-y-auto rounded-lg border border-ink-line text-xs">
                {report.conflicts.map((c, i) => (
                  <div key={`c${i}`} className="flex items-start gap-2 border-b border-ink-line/50 bg-amber-50/40 px-3 py-2 last:border-0">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span>
                      <b>Linha {c.line}</b>{c.name ? ` (${c.name})` : ''} — <b>Conflito:</b> {c.reason}
                      {c.identifier ? <span className="ml-1 text-ink-mute">[{c.identifier}]</span> : null}
                    </span>
                  </div>
                ))}
                {report.skipped.map((s, i) => (
                  <div key={`s${i}`} className="flex items-start gap-2 border-b border-ink-line/50 px-3 py-2 last:border-0">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-mute" />
                    <span>
                      <b>Linha {s.line}</b>{s.name ? ` (${s.name})` : ''} — Ignorada: {s.reason}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={reset}>Importar outro</Button>
              <Button onClick={close}>Fechar</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
