import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { useCustomerAuthStore } from '@/store/useCustomerAuthStore';
import { useSEO } from '@/utils/seo';

const schema = z.object({
  name: z.string().min(3, 'Informe seu nome completo'),
  email: z.string().email('E-mail inválido'),
  phone: z.string().min(10, 'Telefone inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
  passwordConfirm: z.string(),
  privacyConsent: z.literal(true, {
    errorMap: () => ({ message: 'Você precisa aceitar a Política de Privacidade para criar a conta.' }),
  }),
  cep: z.string().optional(),
  street: z.string().optional(),
  number: z.string().optional(),
  complement: z.string().optional(),
  district: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
}).refine((d) => d.password === d.passwordConfirm, {
  message: 'As senhas não coincidem',
  path: ['passwordConfirm'],
});

type Data = z.infer<typeof schema>;

export default function CustomerRegister() {
  useSEO('Criar conta', 'Crie sua conta na 3DCommerce para acompanhar seus pedidos.');
  const navigate = useNavigate();
  const isLogged = useCustomerAuthStore((s) => s.currentCustomerId !== null);
  const registerCustomer = useCustomerAuthStore((s) => s.registerCustomer);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Data>({
    resolver: zodResolver(schema),
  });

  if (isLogged) return <Navigate to="/minha-conta" replace />;

  async function onSubmit(d: Data) {
    const hasAddress = d.cep && d.street && d.number && d.district && d.city && d.state;
    const r = await registerCustomer({
      name: d.name,
      email: d.email,
      phone: d.phone,
      password: d.password,
      privacyConsent: d.privacyConsent,
      defaultAddress: hasAddress
        ? {
            cep: d.cep!,
            street: d.street!,
            number: d.number!,
            complement: d.complement,
            district: d.district!,
            city: d.city!,
            state: d.state!,
          }
        : undefined,
    });
    if (r.ok) {
      toast.success('Conta criada! Bem-vindo.');
      navigate('/minha-conta');
    } else {
      toast.error(r.error ?? 'Erro ao criar conta.');
    }
  }

  return (
    <div className="container-x py-12">
      <div className="mx-auto max-w-2xl">
        <p className="eyebrow">Novo cliente</p>
        <h1 className="section-title">Criar conta na 3DCommerce</h1>
        <p className="mt-3 text-sm text-ink-mute">
          Salve seus dados, acompanhe seus pedidos e finalize compras com mais agilidade.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="card mt-6 space-y-5 p-6">
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-mute">Dados pessoais</h2>
            <div>
              <Label>Nome completo</Label>
              <Input autoComplete="name" {...register('name')} error={errors.name?.message} />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <Label>E-mail</Label>
                <Input type="email" autoComplete="email" {...register('email')} error={errors.email?.message} />
              </div>
              <div>
                <Label>Telefone / WhatsApp</Label>
                <Input autoComplete="tel" placeholder="(54) 99999-9999" {...register('phone')} error={errors.phone?.message} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <Label>Senha</Label>
                <Input type="password" autoComplete="new-password" {...register('password')} error={errors.password?.message} />
              </div>
              <div>
                <Label>Confirmar senha</Label>
                <Input type="password" autoComplete="new-password" {...register('passwordConfirm')} error={errors.passwordConfirm?.message} />
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t border-ink-line pt-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-mute">Endereço (opcional)</h2>
            <p className="text-xs text-ink-mute">Salve agora para agilizar futuras compras.</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>CEP</Label>
                <Input {...register('cep')} />
              </div>
              <div className="col-span-2">
                <Label>Rua</Label>
                <Input {...register('street')} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Número</Label>
                <Input {...register('number')} />
              </div>
              <div className="col-span-2">
                <Label>Complemento</Label>
                <Input {...register('complement')} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Bairro</Label>
                <Input {...register('district')} />
              </div>
              <div>
                <Label>Cidade</Label>
                <Input {...register('city')} />
              </div>
              <div>
                <Label>UF</Label>
                <Input maxLength={2} {...register('state')} />
              </div>
            </div>
          </section>

          <section className="border-t border-ink-line pt-5">
            <label className="flex items-start gap-3 text-sm text-ink-soft">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-ink-line accent-accent"
                {...register('privacyConsent')}
              />
              <span>
                Li e aceito a{' '}
                <Link to="/privacidade" target="_blank" rel="noopener" className="font-semibold text-ink underline">
                  Política de Privacidade
                </Link>{' '}
                e autorizo o tratamento dos meus dados conforme a LGPD.
              </span>
            </label>
            {errors.privacyConsent && (
              <p className="mt-2 text-xs font-medium text-red-600">{errors.privacyConsent.message}</p>
            )}
          </section>

          <Button type="submit" fullWidth size="lg" loading={isSubmitting}>
            Criar conta
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-mute">
          Já tem conta?{' '}
          <Link to="/login" className="font-semibold text-ink hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
