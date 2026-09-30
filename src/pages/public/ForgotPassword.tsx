import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { authService } from '@/services/authService';
import { ApiError } from '@/services/api';
import { useSEO } from '@/utils/seo';

const schema = z.object({
  email: z.string().email('E-mail inválido'),
});
type Data = z.infer<typeof schema>;

export default function ForgotPassword() {
  useSEO('Esqueci minha senha', 'Recupere o acesso à sua conta na 3DCommerce.');
  const [sent, setSent] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Data>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(d: Data) {
    try {
      await authService.forgotPassword(d.email);
    } catch (err) {
      // A rota responde 200 genérico; se algo falhar, não vazamos detalhe.
      if (!(err instanceof ApiError)) {
        toast.error('Não foi possível enviar agora. Tente novamente.');
        return;
      }
    }
    // Mensagem SEMPRE genérica — não revela se o e-mail existe.
    setSent(true);
  }

  return (
    <div className="container-x flex items-center justify-center py-16">
      <div className="w-full max-w-md">
        <p className="eyebrow">Acesso do cliente</p>
        <h1 className="section-title">Esqueci minha senha</h1>
        <p className="mt-3 text-sm text-ink-mute">
          Informe o e-mail da sua conta e enviaremos um link para redefinir a senha.
        </p>

        {sent ? (
          <div className="card mt-6 space-y-4 p-6 text-sm">
            <p className="font-semibold text-ink">Verifique seu e-mail</p>
            <p className="text-ink-mute">
              Se o e-mail informado estiver cadastrado, enviamos um link para redefinir sua senha.
              O link expira em breve.
            </p>
            <Link to="/login" className="inline-block font-semibold text-ink hover:underline">
              ← Voltar para entrar
            </Link>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit(onSubmit)} className="card mt-6 space-y-4 p-6">
              <div>
                <Label>E-mail</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
                  <Input type="email" autoComplete="email" {...register('email')} error={errors.email?.message} className="!pl-9" />
                </div>
              </div>
              <Button type="submit" fullWidth size="lg" loading={isSubmitting}>
                Enviar link de recuperação
              </Button>
            </form>

            <div className="mt-5 text-center text-sm">
              <Link to="/login" className="font-semibold text-ink-mute hover:text-ink">
                ← Voltar para entrar
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
