import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { LogOut, MailWarning, Package, ShoppingBag, User } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { useCustomerAuthStore, useCurrentCustomer } from '@/store/useCustomerAuthStore';
import { useSEO } from '@/utils/seo';
import { useState } from 'react';

const schema = z.object({
  name: z.string().min(3),
  phone: z.string().min(10),
  cep: z.string().optional(),
  street: z.string().optional(),
  number: z.string().optional(),
  complement: z.string().optional(),
  district: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});
type Data = z.infer<typeof schema>;

export default function CustomerAccount() {
  useSEO('Minha conta');
  const customer = useCurrentCustomer();
  const logoutCustomer = useCustomerAuthStore((s) => s.logoutCustomer);
  const updateCustomer = useCustomerAuthStore((s) => s.updateCustomer);
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<Data>({
    resolver: zodResolver(schema),
    defaultValues: customer
      ? {
          name: customer.name,
          phone: customer.phone,
          cep: customer.defaultAddress?.cep,
          street: customer.defaultAddress?.street,
          number: customer.defaultAddress?.number,
          complement: customer.defaultAddress?.complement,
          district: customer.defaultAddress?.district,
          city: customer.defaultAddress?.city,
          state: customer.defaultAddress?.state,
        }
      : undefined,
  });

  if (!customer) return <Navigate to="/login" replace />;

  function onSubmit(d: Data) {
    const hasAddress = d.cep && d.street && d.number && d.district && d.city && d.state;
    updateCustomer({
      name: d.name,
      phone: d.phone,
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
    toast.success('Dados atualizados.');
    setEditing(false);
  }

  function doLogout() {
    logoutCustomer();
    toast.success('Você saiu da conta.');
    navigate('/');
  }

  const first = customer.name.split(' ')[0];

  return (
    <div className="container-x py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Minha conta</p>
          <h1 className="section-title">Olá, {first}!</h1>
          <p className="mt-1 text-sm text-ink-mute">Bom te ver de novo na 3DCommerce.</p>
        </div>
        <button onClick={doLogout} className="btn-secondary !py-2">
          <LogOut className="h-4 w-4" /> Sair
        </button>
      </header>

      {customer.emailVerified === false && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <MailWarning className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">Confirme seu e-mail</p>
            <p className="mt-0.5 text-amber-800">
              Enviamos um link de confirmação para <strong>{customer.email}</strong> quando você criou a conta.
              Você pode continuar usando a loja normalmente — é só uma verificação de segurança.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <section className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 text-base font-bold">
              <User className="h-4 w-4" /> Dados cadastrais
            </h2>
            {!editing && (
              <button onClick={() => setEditing(true)} className="text-xs font-semibold text-ink hover:underline">
                Editar
              </button>
            )}
          </div>

          {!editing ? (
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-ink-mute">Nome</dt><dd className="font-semibold">{customer.name}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-mute">E-mail</dt><dd>{customer.email}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-mute">Telefone</dt><dd>{customer.phone}</dd></div>
              {customer.defaultAddress ? (
                <div>
                  <p className="text-ink-mute">Endereço padrão</p>
                  <p className="mt-1 text-sm">
                    {customer.defaultAddress.street}, {customer.defaultAddress.number}
                    {customer.defaultAddress.complement ? ` (${customer.defaultAddress.complement})` : ''}
                  </p>
                  <p className="text-xs text-ink-mute">
                    {customer.defaultAddress.district}, {customer.defaultAddress.city}/{customer.defaultAddress.state} — {customer.defaultAddress.cep}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-ink-mute">Sem endereço padrão cadastrado.</p>
              )}
            </dl>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4">
              <div>
                <Label>Nome completo</Label>
                <Input {...register('name')} error={errors.name?.message} />
              </div>
              <div>
                <Label>Telefone / WhatsApp</Label>
                <Input {...register('phone')} error={errors.phone?.message} />
              </div>
              <div className="space-y-3 rounded-xl bg-bg-soft p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-ink-mute">Endereço padrão</p>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>CEP</Label><Input {...register('cep')} /></div>
                  <div className="col-span-2"><Label>Rua</Label><Input {...register('street')} /></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>Número</Label><Input {...register('number')} /></div>
                  <div className="col-span-2"><Label>Complemento</Label><Input {...register('complement')} /></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>Bairro</Label><Input {...register('district')} /></div>
                  <div><Label>Cidade</Label><Input {...register('city')} /></div>
                  <div><Label>UF</Label><Input maxLength={2} {...register('state')} /></div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" type="button" onClick={() => { setEditing(false); reset(); }}>Cancelar</Button>
                <Button type="submit" loading={isSubmitting}>Salvar alterações</Button>
              </div>
            </form>
          )}
        </section>

        <aside className="space-y-4">
          <Link
            to="/meus-pedidos"
            className="card group flex items-center justify-between p-5 transition hover:-translate-y-0.5 hover:border-ink/20 hover:shadow-card"
          >
            <div>
              <p className="text-sm font-bold">Meus pedidos</p>
              <p className="mt-0.5 text-xs text-ink-mute">Histórico e status</p>
            </div>
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
              <Package className="h-5 w-5" />
            </span>
          </Link>
          <Link
            to="/loja"
            className="card group flex items-center justify-between p-5 transition hover:-translate-y-0.5 hover:border-ink/20 hover:shadow-card"
          >
            <div>
              <p className="text-sm font-bold">Continuar comprando</p>
              <p className="mt-0.5 text-xs text-ink-mute">Voltar para a loja</p>
            </div>
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <ShoppingBag className="h-5 w-5" />
            </span>
          </Link>
        </aside>
      </div>
    </div>
  );
}
