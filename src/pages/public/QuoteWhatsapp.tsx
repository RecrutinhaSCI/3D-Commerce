import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MessageCircle, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { useState } from 'react';
import { useSEO } from '@/utils/seo';
import toast from 'react-hot-toast';
import { quoteService } from '@/services/quoteService';
import { ApiError } from '@/services/api';
import { Paperclip, Send, X } from 'lucide-react';

const schema = z.object({
  name: z.string().min(3, 'Informe seu nome'),
  phone: z.string().min(10, 'Telefone inválido'),
  email: z.string().email('E-mail inválido'),
  description: z.string().min(10, 'Descreva o projeto'),
  deadline: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

/** Limite por arquivo do upload (corpo de 4,5 MB por requisição na Vercel). */
const MAX_QUOTE_FILE_BYTES = 4 * 1024 * 1024;

export default function QuoteWhatsapp() {
  useSEO('Solicitar orçamento');
  const products = useAdminDataStore((s) => s.products.filter((p) => p.active));
  const settingsPhone = useAdminDataStore((s) => s.settings.whatsapp);
  const quoteProducts = products.filter((p) => p.purchaseMode !== 'direct');
  const [selected, setSelected] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors }, reset } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  function pickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list) return;
    const next: File[] = [...files];
    const tooBig: string[] = [];
    for (let i = 0; i < list.length && next.length < 10; i++) {
      if (list[i].size > MAX_QUOTE_FILE_BYTES) tooBig.push(list[i].name);
      else next.push(list[i]);
    }
    if (tooBig.length) {
      toast.error(`Arquivo acima de 4 MB: ${tooBig.join(', ')}. Envie esse arquivo pelo WhatsApp.`);
    }
    setFiles(next);
    e.target.value = '';
  }
  function removeFile(idx: number) {
    setFiles(files.filter((_, i) => i !== idx));
  }

  async function onSubmit(data: FormData) {
    const selectedProducts = selected
      .map((id) => products.find((p) => p.id === id)?.name)
      .filter(Boolean) as string[];
    const title = selectedProducts.length
      ? `Orçamento — ${selectedProducts[0]}${selectedProducts.length > 1 ? ' + outros' : ''}`
      : 'Orçamento personalizado';
    const description =
      data.description +
      (selectedProducts.length
        ? `\n\nProdutos de interesse:\n${selectedProducts.map((n) => `- ${n}`).join('\n')}`
        : '');

    setSubmitting(true);
    try {
      const { quote } = await quoteService.create({
        customerName: data.name,
        customerEmail: data.email,
        customerPhone: data.phone,
        title,
        description,
        deadline: data.deadline || null,
      });
      if (files.length > 0) {
        try {
          await quoteService.uploadFiles(quote.id, files);
        } catch (err) {
          const msg = err instanceof ApiError ? err.message : 'Falha ao enviar arquivos.';
          toast.error(msg);
        }
      }
      setSuccessId(quote.id);
      setFiles([]);
      setSelected([]);
      reset();
      toast.success('Orçamento enviado! Entraremos em contato.');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erro ao enviar orçamento.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function openWhatsappBackup() {
    const message = `Olá, 3DCommerce! Gostaria de solicitar um orçamento.`;
    window.open(`https://wa.me/${settingsPhone}?text=${encodeURIComponent(message)}`, '_blank');
  }

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  return (
    <div className="container-x py-10">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_360px]">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-ink-mute">Orçamento</p>
          <h1 className="mt-1 text-3xl font-bold">Solicite seu orçamento personalizado</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-mute">
            Para produtos personalizados, encomendas em quantidade ou itens sob consulta — preencha abaixo e
            falaremos com você diretamente no WhatsApp.
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label>Nome completo</Label>
                <Input {...register('name')} error={errors.name?.message} />
              </div>
              <div>
                <Label>Telefone / WhatsApp</Label>
                <Input {...register('phone')} placeholder="(54) 99999-9999" error={errors.phone?.message} />
              </div>
              <div>
                <Label>E-mail (opcional)</Label>
                <Input type="email" {...register('email')} error={errors.email?.message} />
              </div>
              <div>
                <Label>Prazo desejado (opcional)</Label>
                <Input {...register('deadline')} placeholder="Ex: até 15 dias" />
              </div>
            </div>
            <div>
              <Label>Descrição do projeto</Label>
              <Textarea
                {...register('description')}
                rows={5}
                placeholder="Conte para nós o que você precisa: quantidade, tema, prazo, características..."
                error={errors.description?.message}
              />
            </div>

            {quoteProducts.length > 0 && (
              <div>
                <Label>Produtos de interesse (opcional)</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {quoteProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggle(p.id)}
                      className={`flex items-center gap-2 rounded-xl border p-2 text-left text-xs ${
                        selected.includes(p.id) ? 'border-ink bg-bg-soft' : 'border-ink-line'
                      }`}
                    >
                      <img src={p.images[0]} alt="" className="h-10 w-10 rounded-lg object-cover" />
                      <span className="line-clamp-2 font-semibold">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <Label>Arquivos (STL, OBJ, ZIP, PDF ou imagens — até 4 MB cada; maiores, envie pelo WhatsApp)</Label>
              <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-ink-line bg-bg-soft px-4 py-3 text-sm text-ink-soft hover:bg-ink/5">
                <Paperclip className="h-4 w-4" />
                Adicionar arquivos
                <input
                  type="file"
                  multiple
                  className="hidden"
                  accept=".stl,.obj,.zip,.pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp,application/pdf,application/zip,application/octet-stream"
                  onChange={pickFiles}
                />
              </label>
              {files.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs">
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center justify-between rounded-lg bg-bg-soft px-3 py-1.5">
                      <span className="truncate">{f.name} · {Math.round(f.size / 1024)}kb</span>
                      <button type="button" onClick={() => removeFile(i)} aria-label="Remover">
                        <X className="h-3.5 w-3.5 text-ink-mute" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {successId && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                Orçamento <strong>{successId}</strong> recebido. Nosso time entrará em contato em breve.
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="lg" loading={submitting} disabled={submitting}>
                <Send className="h-4 w-4" /> Enviar orçamento
              </Button>
              <Button type="button" variant="whatsapp" size="lg" onClick={openWhatsappBackup}>
                <MessageCircle className="h-4 w-4" /> Falar no WhatsApp
              </Button>
            </div>
          </form>
        </div>

        <aside className="card h-fit p-5">
          <h2 className="text-base font-bold">Como funciona</h2>
          <ol className="mt-3 space-y-3 text-sm text-ink-mute">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-ink text-bg text-xs font-bold">
                1
              </span>
              Preencha o formulário com o máximo de detalhes possível.
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-ink text-bg text-xs font-bold">
                2
              </span>
              Você é redirecionado para nosso WhatsApp com a mensagem pronta.
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-ink text-bg text-xs font-bold">
                3
              </span>
              Nossa equipe analisa e envia um orçamento personalizado em até 1 dia útil.
            </li>
          </ol>
          <div className="mt-5 rounded-xl bg-bg-soft p-4 text-xs text-ink-mute">
            <p className="inline-flex items-center gap-1.5 font-semibold text-ink">
              <ListChecks className="h-4 w-4" /> Ideal para
            </p>
            <ul className="mt-2 space-y-1">
              <li>• Produtos personalizados em 3D</li>
              <li>• Compras em grande quantidade</li>
              <li>• Brindes corporativos</li>
              <li>• Projetos sob medida</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
