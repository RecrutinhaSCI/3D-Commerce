import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Check, Mail, MapPin, MessageCircle, Send } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { useSEO } from '@/utils/seo';
import { whatsappContact } from '@/utils/whatsapp';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { site } from '@/config/site';
import { contactService } from '@/services/contactService';
import { ApiError } from '@/services/api';

const schema = z.object({
  name: z.string().min(3, 'Informe seu nome'),
  email: z.string().email('E-mail inválido'),
  phone: z.string().optional(),
  message: z.string().min(10, 'Mensagem muito curta'),
});
type Data = z.infer<typeof schema>;

export default function Contact() {
  useSEO('Contato');
  const settings = useAdminDataStore((s) => s.settings);
  const { register, handleSubmit, getValues, formState: { errors, isSubmitting }, reset } = useForm<Data>({
    resolver: zodResolver(schema),
  });
  const [sent, setSent] = useState(false);

  // Envia pelo site: fica salvo em /admin/mensagens e a loja recebe por e-mail.
  async function onSubmit(d: Data) {
    try {
      await contactService.send({ name: d.name, email: d.email, phone: d.phone || null, message: d.message });
      setSent(true);
      reset();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível enviar agora. Tente pelo WhatsApp.');
    }
  }

  // Alternativa: abre o WhatsApp com o texto já preenchido.
  function sendWhatsapp() {
    const d = getValues();
    const url = `https://wa.me/${settings.whatsapp}?text=${encodeURIComponent(
      `Olá, 3DCommerce!\n\nNome: ${d.name ?? ''}\nE-mail: ${d.email ?? ''}\n\n${d.message ?? ''}`,
    )}`;
    window.open(url, '_blank');
  }

  return (
    <div className="container-x py-12">
      <header className="max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-widest text-ink-mute">Contato</p>
        <h1 className="mt-2 font-display text-4xl font-bold">Fale com a 3DCommerce</h1>
        <p className="mt-3 text-ink-mute">Atendimento humano, rápido e técnico. Estamos prontos para ajudar.</p>
      </header>

      <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-2">
        {sent ? (
          <div className="card flex flex-col items-start gap-3 p-6">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <Check className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-bold">Mensagem enviada!</h2>
            <p className="text-sm text-ink-mute">Recebemos seu contato e respondemos no seu e-mail. Precisa de algo urgente? Chame no WhatsApp.</p>
            <Button variant="secondary" onClick={() => setSent(false)}>Enviar outra mensagem</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6">
            <div>
              <Label>Nome</Label>
              <Input {...register('name')} error={errors.name?.message} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>E-mail</Label>
                <Input type="email" {...register('email')} error={errors.email?.message} />
              </div>
              <div>
                <Label>WhatsApp (opcional)</Label>
                <Input {...register('phone')} inputMode="tel" />
              </div>
            </div>
            <div>
              <Label>Mensagem</Label>
              <Textarea {...register('message')} rows={5} error={errors.message?.message} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="lg" type="submit" loading={isSubmitting}>
                <Send className="h-4 w-4" /> Enviar mensagem
              </Button>
              <Button variant="whatsapp" size="lg" type="button" onClick={sendWhatsapp}>
                <MessageCircle className="h-4 w-4" /> Prefiro WhatsApp
              </Button>
            </div>
          </form>
        )}

        <div className="space-y-4">
          <div className="card p-6">
            <h3 className="text-base font-bold">Canais de contato</h3>
            <ul className="mt-3 space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 text-ink-mute" />
                <span>{settings.address}</span>
              </li>
              <li className="flex items-start gap-3">
                <MessageCircle className="mt-0.5 h-4 w-4 text-emerald-500" />
                <a href={whatsappContact()} target="_blank" rel="noreferrer" className="hover:underline">
                  WhatsApp {site.whatsappDisplay}
                </a>
              </li>
              <li className="flex items-start gap-3">
                <Mail className="mt-0.5 h-4 w-4 text-ink-mute" />
                <a href={`mailto:${settings.email}`} className="hover:underline">{settings.email}</a>
              </li>
            </ul>
          </div>
          <div className="card p-6">
            <h3 className="text-base font-bold">Horário de atendimento</h3>
            <p className="mt-2 text-sm text-ink-mute">Segunda a sexta: 9h às 19h</p>
            <p className="text-sm text-ink-mute">Sábado: 9h às 13h</p>
          </div>
        </div>
      </div>
    </div>
  );
}
