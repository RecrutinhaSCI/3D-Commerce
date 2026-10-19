import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Lock, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input, Label, PasswordInput } from '@/components/ui/Input';
import { useAdminAuthStore } from '@/store/useAdminAuthStore';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { Logo } from '@/components/ui/Logo';
import { useSEO } from '@/utils/seo';

export default function Login() {
  useSEO('Admin Login');
  const isAuthenticated = useAdminAuthStore((s) => s.isAuthenticated);
  const login = useAdminAuthStore((s) => s.login);
  const loading = useAdminAuthStore((s) => s.loading);
  const refreshAdmin = useAdminDataStore((s) => s.refreshAdmin);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  if (isAuthenticated) return <Navigate to="/admin" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await login(email, password);
    if (!ok) {
      toast.error('E-mail ou senha inválidos.');
      return;
    }
    toast.success('Bem-vindo!');
    // Puxa dados admin já com o token válido.
    await refreshAdmin();
    navigate('/admin');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-5">
      <form onSubmit={submit} className="card w-full max-w-md p-7">
        <Logo />
        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-ink-mute">Painel administrativo</p>
        <h1 className="mt-5 text-2xl font-bold">Acessar admin</h1>
        <p className="mt-1 text-sm text-ink-mute">Use suas credenciais para entrar.</p>

        <div className="mt-6 space-y-4">
          <div>
            <Label>E-mail</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="!pl-9"
                placeholder="seu-email@exemplo.com"
                required
              />
            </div>
          </div>
          <div>
            <Label>Senha</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-ink-mute" />
              <PasswordInput
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="!pl-9"
                required
              />
            </div>
          </div>
        </div>

        <Button type="submit" fullWidth className="mt-6" loading={loading}>
          Entrar
        </Button>
      </form>
    </div>
  );
}
