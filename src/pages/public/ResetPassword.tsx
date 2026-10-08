import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { authService } from '@/services/authService';
import { ApiError } from '@/services/api';
import { useSEO } from '@/utils/seo';

const schema = z.object({
  password: z.string().min(6, 'Mínimo 6 caracteres'),
  passwordConfirm: z.string(),
}).refine((d) => d.password === d.passwordConfirm, {
  message: 'As senhas não coincidem',
  path: ['passwordConfirm'],
});
type Data = z.infer<typeof schema>;

export default function ResetPassword() {
  useSEO('Redefinir senha', 'Defina uma nova senha para sua conta na 3DCommerce.');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Data>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(d: Data) {
    try {
      await authService.resetPassword(token, d.password);
      setDone(true);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Não foi possível redefinir a senha.';
      toast.error(msg);
    }
  }

  return (
    <div className="container-x flex items-center justify-center py-16">
      <div className="w-full max-w-md">
        <p className="eyebrow">Acesso do cliente</p>
        <h1 className="section-title">Redefinir senha</h1>

        {!token ? (
          <div className="card mt-6 space-y-4 p-6 text-sm">
            <p className="font-semibold text-ink">Link inválido</p>
            <p className="text-ink-mute">
              O link de redefinição está incompleto ou expirou. Solicite um novo.
            </p>
            <Link to="/esqueci-senha" className="inline-block font-semibold text-ink hover:underline">
              Pedir novo link
            </Link>
          </div>
        ) : done ? (
          <div className="card mt-6 space-y-4 p-6 text-sm">
            <p className="font-semibold text-ink">Senha redefinida!</p>
            <p className="text-ink-mute">Sua nova senha já está ativa. Você já pode entrar na sua conta.</p>
            <Link to="/login" className="inline-block font-semibold text-ink hover:underline">
              Ir para entrar →
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-3 text-sm text-ink-mute">Escolha uma nova senha para sua conta.</p>
            <form onSubmit={handleSubmit(onSubmit)} className="card mt-6 space-y-4 p-6">
              <div>
                <Label>Nova senha</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
                  <Input type="password" autoComplete="new-password" {...register('password')} error={errors.password?.message} className="!pl-9" />
                </div>
              </div>
              <div>
                <Label>Confirmar nova senha</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
                  <Input type="password" autoComplete="new-password" {...register('passwordConfirm')} error={errors.passwordConfirm?.message} className="!pl-9" />
                </div>
              </div>
              <Button type="submit" fullWidth size="lg" loading={isSubmitting}>
                Redefinir senha
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
