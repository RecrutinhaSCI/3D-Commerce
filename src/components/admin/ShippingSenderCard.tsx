import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Input';
import { ApiError } from '@/services/api';
import {
  shippingLabelsService,
  type ApiSenderReadiness,
  type ApiShippingLabelsConfig,
  type ApiShippingSender,
} from '@/services/shippingLabelsService';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

type Form = Record<keyof ApiShippingSender, string>;

const EMPTY: Form = {
  name: '', document: '', stateRegister: '', economicActivityCode: '', phone: '', email: '',
  postalCode: '', address: '', number: '', complement: '', district: '', city: '', stateAbbr: '',
};

const toForm = (s: ApiShippingSender | null): Form =>
  s ? (Object.fromEntries(Object.keys(EMPTY).map((k) => [k, s[k as keyof ApiShippingSender] ?? ''])) as Form) : EMPTY;

/** Erros de campo do 422 do backend (zod flatten). */
function fieldErrors(err: unknown): Partial<Record<keyof Form, string>> {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR') return {};
  const fe = (err.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {};
  return Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0]])) as Partial<Record<keyof Form, string>>;
}

/**
 * Configurações → "Remetente das etiquetas": dados estruturados da loja que
 * vão como remetente no Melhor Envio. O backend valida tudo (CPF/CNPJ, CEP,
 * UF, IE) e nunca expõe estes dados no site público.
 */
export function ShippingSenderCard() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [saved, setSaved] = useState(false);
  const [readiness, setReadiness] = useState<ApiSenderReadiness | null>(null);
  const [config, setConfig] = useState<ApiShippingLabelsConfig | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([shippingLabelsService.sender(), shippingLabelsService.config()])
      .then(([s, c]) => {
        if (!alive) return;
        setForm(toForm(s.sender ?? s.suggestion));
        setSaved(Boolean(s.sender));
        setReadiness(s.readiness);
        setConfig(c);
      })
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setErrors({});
    try {
      const payload: ApiShippingSender = {
        ...form,
        stateRegister: form.stateRegister.trim() || null,
        economicActivityCode: form.economicActivityCode.trim() || null,
        complement: form.complement.trim() || null,
      };
      const res = await shippingLabelsService.saveSender(payload);
      setForm(toForm(res.sender));
      setSaved(true);
      setReadiness(res.readiness);
      setConfig((c) => (c ? { ...c, sender: res.readiness } : c));
      toast.success('Remetente salvo.');
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err instanceof ApiError && err.code !== 'VALIDATION_ERROR' ? err.message : 'Confira os campos destacados.');
    } finally {
      setSaving(false);
    }
  }

  const field = (k: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <Label>{label}</Label>
      <Input name={k} value={form[k]} onChange={set(k)} error={errors[k]} {...props} />
    </div>
  );

  const status = !config
    ? null
    : !config.enabled
      ? { text: 'Etiquetas desligadas', cls: 'bg-ink/10 text-ink-mute' }
      : config.isTest
        ? { text: 'Sandbox — etiquetas de teste', cls: 'bg-amber-100 text-amber-800' }
        : config.purchaseAllowed
          ? { text: 'Produção liberada', cls: 'bg-emerald-100 text-emerald-700' }
          : { text: 'Produção bloqueada', cls: 'bg-rose-100 text-rose-700' };

  return (
    <form onSubmit={save} className="card mt-6 space-y-4 p-5" data-testid="shipping-sender-card" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">Remetente das etiquetas (Melhor Envio)</h2>
          <p className="mt-1 text-xs text-ink-mute">
            Dados da loja impressos como remetente. Não aparecem no site público.
          </p>
        </div>
        {status && <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${status.cls}`}>{status.text}</span>}
      </div>

      {loading ? (
        <p className="text-sm text-ink-mute">Carregando remetente…</p>
      ) : failed ? (
        <p className="text-sm text-rose-600">Não foi possível carregar o remetente.</p>
      ) : (
        <>
          {!saved && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Ainda não cadastrado. Pré-preenchemos com os dados da loja — confira e complete o endereço.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {field('name', 'Nome / razão social', { maxLength: 100 })}
            {field('document', 'CPF ou CNPJ', { inputMode: 'numeric' })}
            {field('stateRegister', 'Inscrição estadual (ou ISENTO)')}
            {field('economicActivityCode', 'CNAE (opcional)', { inputMode: 'numeric' })}
            {field('phone', 'Telefone', { inputMode: 'tel' })}
            {field('email', 'E-mail', { type: 'email' })}
            {field('postalCode', 'CEP', { inputMode: 'numeric' })}
            {field('address', 'Endereço (rua)')}
            {field('number', 'Número')}
            {field('complement', 'Complemento (opcional)')}
            {field('district', 'Bairro')}
            {field('city', 'Cidade')}
            <div>
              <Label>UF</Label>
              <Select name="stateAbbr" value={form.stateAbbr} onChange={set('stateAbbr')} error={errors.stateAbbr}>
                <option value="">Selecione</option>
                {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </Select>
            </div>
          </div>

          {readiness && saved && (
            <div className="rounded-lg border border-ink-line bg-bg-soft p-3 text-sm" data-testid="sender-readiness">
              <p>
                Declaração de conteúdo: <b>{readiness.declaration ? 'pronto' : 'pendente'}</b> · Envio com NF-e:{' '}
                <b>{readiness.nfe ? 'pronto' : 'pendente'}</b>
              </p>
              {readiness.issues.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-xs text-ink-mute">
                  {readiness.issues.map((i) => <li key={i}>{i}</li>)}
                </ul>
              )}
            </div>
          )}

          <Button type="submit" loading={saving} disabled={saving}>
            <Save className="h-4 w-4" /> Salvar remetente
          </Button>
        </>
      )}
    </form>
  );
}
