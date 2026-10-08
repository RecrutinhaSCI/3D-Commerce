import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { safeRedirect } from '@/utils/redirect';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Lock, Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { useCustomerAuthStore } from '@/store/useCustomerAuthStore';
import { useSEO } from '@/utils/seo';

const schema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});
type Data = z.infer<typeof schema>;

export default function CustomerLogin() {
  useSEO('Entrar', 'Acompanhe seus pedidos e agilize suas próximas compras na 3DCommerce.');
  const navigate = useNavigate();
  const location = useLocation();
  // Volta para onde o cliente estava (ex.: checkout), se veio com ?redirect=.
  const dest = safeRedirect(location.search);
  const isLogged = useCustomerAuthStore((s) => s.currentCustomerId !== null);
  const loginCustomer = useCustomerAuthStore((s) => s.loginCustomer);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Data>({
    resolver: zodResolver(schema),
  });

  if (isLogged) return <Navigate to={dest} replace />;

  async function onSubmit(d: Data) {
    const r = await loginCustomer(d.email, d.password);
    if (r.ok) {
      toast.success('Bem-vindo de volta!');
      navigate(dest, { replace: true });
    } else {
      toast.error(r.error ?? 'Erro ao entrar.');
    }
  }

  return (
    <div className="container-x flex items-center justify-center py-16">
      <div className="w-full max-w-md">
        <p className="eyebrow">Acesso do cliente</p>
        <h1 className="section-title">Entrar na minha conta</h1>
        <p className="mt-3 text-sm text-ink-mute">Acompanhe seus pedidos e agilize suas próximas compras.</p>

        <form onSubmit={handleSubmit(onSubmit)} className="card mt-6 space-y-4 p-6">
          <div>
            <Label>E-mail</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
              <Input type="email" autoComplete="email" {...register('email')} error={errors.email?.message} className="!pl-9" />
            </div>
          </div>
          <div>
            <Label>Senha</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
              <Input type="password" autoComplete="current-password" {...register('password')} error={errors.password?.message} className="!pl-9" />
            </div>
          </div>
          <div className="flex justify-end">
            <Link to="/esqueci-senha" className="text-xs font-semibold text-ink-mute hover:text-ink hover:underline">
              Esqueci minha senha
            </Link>
          </div>
          <Button type="submit" fullWidth size="lg" loading={isSubmitting}>
            Entrar
          </Button>
        </form>

        <div className="mt-5 flex flex-col items-center gap-2 text-sm">
          <p className="text-ink-mute">
            Ainda não tem conta?{' '}
            <Link to={"/criar-conta" + location.search} className="font-semibold text-ink hover:underline">
              Criar conta
            </Link>
          </p>
          <Link to="/loja" className="text-xs font-semibold text-ink-mute hover:text-ink">
            ← Continuar comprando
          </Link>
        </div>
      </div>
    </div>
  );
}
