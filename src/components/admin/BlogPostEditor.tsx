import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { RotateCcw, Save } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { BlogMarkdown } from '@/components/blog/BlogMarkdown';
import { settingsService } from '@/services/settingsService';
import { apiSettingsToInternal } from '@/services/adapters';
import { ApiError } from '@/services/api';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import type { BlogPost } from '@/types';
import { countWords, estimateReadTime } from '@/utils/blog';

interface Props {
  /** Post já resolvido (padrão + versão salva). */
  post: BlogPost & { customized: boolean };
  /** Texto padrão do código (para "Restaurar padrão"). */
  base: BlogPost;
  onClose: () => void;
}

type Draft = Pick<BlogPost, 'title' | 'category' | 'excerpt' | 'readTime' | 'content'>;

/**
 * Editor de um post: título, categoria, resumo, tempo de leitura e conteúdo
 * em Markdown com preview. Desktop: editor e preview lado a lado; celular:
 * abas "Escrever | Preview". Salva por slug em site_settings.blog_content_json.
 */
export function BlogPostEditor({ post, base, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>({
    title: post.title,
    category: post.category,
    excerpt: post.excerpt,
    readTime: post.readTime,
    content: post.content,
  });
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const words = useMemo(() => countWords(draft.content), [draft.content]);
  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  function applySettings(s: Parameters<typeof apiSettingsToInternal>[0]) {
    useAdminDataStore.setState({ settings: apiSettingsToInternal(s) });
  }

  async function save() {
    if (!draft.title.trim() || !draft.content.trim()) {
      toast.error('Título e conteúdo não podem ficar vazios.');
      return;
    }
    // Só grava o que difere do padrão: o resto continua acompanhando o código.
    const diff = Object.fromEntries(
      (Object.keys(draft) as (keyof Draft)[])
        .filter((k) => draft[k].trim() !== base[k].trim())
        .map((k) => [k, draft[k].trim()]),
    );
    setBusy(true);
    try {
      const { settings } = Object.keys(diff).length
        ? await settingsService.updateBlogContent(post.slug, diff)
        : await settingsService.resetBlogContent(post.slug);
      applySettings(settings);
      toast.success('Post salvo.');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível salvar o post.');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const { settings } = await settingsService.resetBlogContent(post.slug);
      applySettings(settings);
      toast.success('Post restaurado para o texto padrão.');
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível restaurar.');
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Editar post" maxWidth="max-w-6xl">
      <div className="space-y-4">
        <p className="text-xs text-ink-mute">
          URL fixa: <span className="font-mono">/blog/{post.slug}</span>
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_1fr]">
          <div>
            <Label>Título</Label>
            <Input value={draft.title} onChange={(e) => set('title', e.target.value)} maxLength={160} />
          </div>
          <div>
            <Label>Categoria / tag</Label>
            <Input value={draft.category} onChange={(e) => set('category', e.target.value)} maxLength={40} />
          </div>
          <div>
            <Label>Tempo de leitura</Label>
            <div className="flex gap-2">
              <Input value={draft.readTime} onChange={(e) => set('readTime', e.target.value)} maxLength={20} placeholder="5 min" />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => set('readTime', estimateReadTime(draft.content))}
                title="Calcular pelo tamanho do texto (~200 palavras/min)"
              >
                Calcular
              </Button>
            </div>
          </div>
        </div>
        <div>
          <Label>Resumo (aparece na lista do blog e no topo do post)</Label>
          <Textarea value={draft.excerpt} onChange={(e) => set('excerpt', e.target.value)} rows={2} maxLength={400} className="!min-h-0" />
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <Label>Conteúdo (Markdown)</Label>
            {/* Abas só no celular/tablet; no desktop os dois painéis ficam lado a lado. */}
            <div className="inline-flex rounded-lg border border-ink-line p-0.5 text-xs font-semibold lg:hidden" role="tablist">
              {(['write', 'preview'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`rounded-md px-3 py-1 ${tab === t ? 'bg-ink text-bg' : 'text-ink-soft'}`}
                >
                  {t === 'write' ? 'Escrever' : 'Preview'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className={tab === 'write' ? '' : 'hidden lg:block'}>
              <Textarea
                value={draft.content}
                onChange={(e) => set('content', e.target.value)}
                aria-label="Conteúdo em Markdown"
                spellCheck
                className="h-[48vh] min-h-[320px] resize-y font-mono text-[13px] leading-relaxed"
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-mute">
                Markdown: <code>## Título</code> · <code>### Subtítulo</code> · <code>**negrito**</code> · <code>*itálico*</code> ·{' '}
                <code>- lista</code> · <code>1. lista</code> · <code>[texto](/loja)</code> · <code>&gt; citação</code> ·{' '}
                <code>---</code> · tabelas com <code>| a | b |</code>. HTML não é exibido. {words} palavras.
              </p>
            </div>
            <div className={tab === 'preview' ? '' : 'hidden lg:block'}>
              <div className="h-[48vh] min-h-[320px] overflow-y-auto rounded-xl border border-ink-line bg-bg-card px-5 pb-6">
                <h1 className="mt-5 font-display text-2xl font-bold">{draft.title || 'Sem título'}</h1>
                {draft.excerpt && <p className="mt-3 text-ink">{draft.excerpt}</p>}
                <BlogMarkdown content={draft.content} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-line pt-4">
          <div>
            {post.customized &&
              (confirmReset ? (
                <span className="inline-flex items-center gap-2 text-xs">
                  Descartar a versão salva?
                  <Button type="button" variant="danger" size="sm" onClick={reset} disabled={busy}>Restaurar</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>Não</Button>
                </span>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
                  <RotateCcw className="h-4 w-4" /> Restaurar texto padrão
                </Button>
              ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button type="button" onClick={save} disabled={busy}>
              <Save className="h-4 w-4" /> {busy ? 'Salvando…' : 'Salvar post'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
