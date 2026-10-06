import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, Mail, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSEO } from '@/utils/seo';
import { ApiError } from '@/services/api';
import {
  contactService,
  type ApiContactMessage,
  type ApiNewsletterSubscriber,
  type ContactMessageStatus,
} from '@/services/contactService';

const statusLabels: Record<ContactMessageStatus, string> = {
  NEW: 'Nova',
  READ: 'Lida',
  ANSWERED: 'Respondida',
  ARCHIVED: 'Arquivada',
};
const statusTone: Record<ContactMessageStatus, string> = {
  NEW: 'bg-cyan-100 text-cyan-700',
  READ: 'bg-ink/10 text-ink-soft',
  ANSWERED: 'bg-emerald-100 text-emerald-700',
  ARCHIVED: 'bg-ink/5 text-ink-mute',
};

/** Exporta os e-mails da newsletter em CSV (abre no Excel/Google Planilhas). */
function downloadCsv(rows: ApiNewsletterSubscriber[]) {
  const lines = ['email;origem;inscrito_em', ...rows.map((r) => `${r.email};${r.source ?? ''};${new Date(r.createdAt).toLocaleString('pt-BR')}`)];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `newsletter-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Messages() {
  useSEO('Admin Mensagens');
  const [tab, setTab] = useState<'contact' | 'newsletter'>('contact');
  const [messages, setMessages] = useState<ApiContactMessage[]>([]);
  const [subscribers, setSubscribers] = useState<ApiNewsletterSubscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, s] = await Promise.all([contactService.listMessages(), contactService.listSubscribers()]);
      setMessages(m.messages);
      setSubscribers(s.subscribers);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível carregar as mensagens.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(id: string, status: ContactMessageStatus) {
    try {
      await contactService.setMessageStatus(id, status);
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status } : m)));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível alterar o status.');
    }
  }

  const newCount = messages.filter((m) => m.status === 'NEW').length;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Relacionamento</p>
          <h1 className="section-title">Mensagens</h1>
          <p className="mt-1 text-sm text-ink-mute">
            {newCount} mensagem(ns) nova(s) · {subscribers.length} inscrito(s) na newsletter
          </p>
        </div>
        <Button variant="secondary" size="sm" loading={loading} onClick={load}>
          <RefreshCw className="h-4 w-4" /> Atualizar
        </Button>
      </header>

      <div className="mb-4 flex gap-2" role="tablist">
        {([['contact', 'Contato'], ['newsletter', 'Newsletter']] as const).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
              tab === key ? 'border-ink bg-ink text-bg' : 'border-ink-line text-ink-soft hover:border-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-600">
          {error} <button onClick={load} className="font-semibold underline">Tentar novamente</button>
        </div>
      )}

      {tab === 'contact' &&
        (!loading && messages.length === 0 ? (
          <EmptyState title="Nenhuma mensagem ainda." description="As mensagens do formulário de contato aparecem aqui." icon={<Mail className="h-6 w-6" />} />
        ) : (
          <div className="space-y-3">
            {messages.map((m) => (
              <article key={m.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{m.name}</p>
                    <p className="text-xs text-ink-mute">
                      <a href={`mailto:${m.email}`} className="hover:underline">{m.email}</a>
                      {m.phone ? ` · ${m.phone}` : ''} · {new Date(m.createdAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${statusTone[m.status]}`}>{statusLabels[m.status]}</span>
                    <Select
                      value={m.status}
                      onChange={(e) => changeStatus(m.id, e.target.value as ContactMessageStatus)}
                      className="!w-auto !py-1 text-xs"
                      aria-label="Status da mensagem"
                    >
                      {(Object.keys(statusLabels) as ContactMessageStatus[]).map((s) => (
                        <option key={s} value={s}>{statusLabels[s]}</option>
                      ))}
                    </Select>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-line text-sm text-ink-soft">{m.message}</p>
                <a
                  href={`mailto:${m.email}?subject=${encodeURIComponent('Re: seu contato com a 3DCommerce')}`}
                  onClick={() => m.status === 'NEW' && changeStatus(m.id, 'READ')}
                  className="mt-3 inline-block text-xs font-semibold text-ink hover:underline"
                >
                  Responder por e-mail →
                </a>
              </article>
            ))}
          </div>
        ))}

      {tab === 'newsletter' && (
        <div className="card overflow-x-auto">
          <div className="flex items-center justify-between border-b border-ink-line p-4">
            <p className="text-sm text-ink-mute">{subscribers.length} inscrito(s) ativo(s)</p>
            <Button size="sm" variant="secondary" disabled={subscribers.length === 0} onClick={() => downloadCsv(subscribers)}>
              <Download className="h-4 w-4" /> Exportar CSV
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-bg-soft text-left text-xs uppercase tracking-wider text-ink-mute">
              <tr>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Origem</th>
                <th className="px-4 py-3">Inscrito em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-line">
              {!loading && subscribers.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-10 text-center text-ink-mute">Nenhum inscrito ainda.</td></tr>
              )}
              {subscribers.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3">{s.email}</td>
                  <td className="px-4 py-3 text-ink-mute">{s.source ?? '—'}</td>
                  <td className="px-4 py-3 text-ink-mute">{new Date(s.createdAt).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
