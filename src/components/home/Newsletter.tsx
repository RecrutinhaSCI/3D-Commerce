import { useState } from 'react';
import toast from 'react-hot-toast';
import { Mail } from 'lucide-react';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { contactService } from '@/services/contactService';
import { ApiError } from '@/services/api';

export function Newsletter() {
  const settings = useAdminDataStore((s) => s.settings);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  if (!settings.newsletterEnabled) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast.error('Digite um e-mail válido.');
      return;
    }
    setSending(true);
    try {
      await contactService.subscribe(email);
      toast.success(settings.newsletterSuccessMessage);
      setEmail('');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível inscrever agora. Tente de novo.');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="container-x py-16">
      <div className="overflow-hidden rounded-3xl bg-ink p-8 text-bg md:p-12">
        <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-bg/60">{settings.newsletterEyebrow}</p>
            <h2 className="mt-1 font-display text-3xl font-bold">{settings.newsletterTitle}</h2>
            <p className="mt-2 text-sm text-bg/70">{settings.newsletterDescription}</p>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
            <label className="relative flex-1">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={settings.newsletterPlaceholder}
                className="w-full rounded-xl bg-bg px-9 py-3 text-sm text-ink placeholder:text-ink-mute outline-none"
              />
            </label>
            <button type="submit" disabled={sending} className="btn-primary !bg-accent !text-ink hover:!bg-accent-soft disabled:opacity-60">
              {settings.newsletterButtonText}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
