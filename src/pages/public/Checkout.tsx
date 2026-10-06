import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { ChevronRight, Check, Copy, ExternalLink, Clock } from 'lucide-react';
import { useCartStore, getCartDiscount, getCartShipping, getCartSubtotal } from '@/store/useCartStore';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { formatBRL } from '@/utils/price';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSEO } from '@/utils/seo';
import { useCurrentCustomer } from '@/store/useCustomerAuthStore';
import { maskPhone, maskCPF, maskCEP } from '@/utils/masks';
import { orderService } from '@/services/orderService';
import { paymentService } from '@/services/paymentService';
import { shippingService } from '@/services/shippingService';
import { ApiError } from '@/services/api';
import { apiOrderToInternal } from '@/services/adapters';
import { CardPaymentBrick, type PaymentBrickSubmit } from '@/components/checkout/PaymentBrick';
import type {
  ApiOrder,
  ApiCardPaymentResult,
  ApiPixPaymentResult,
  ApiBoletoPaymentResult,
  ApiShippingMethod,
} from '@/services/types';

const customerSchema = z.object({
  name: z.string().min(3, 'Informe seu nome completo'),
  email: z.string().email('E-mail inválido'),
  phone: z.string().min(10, 'Telefone inválido'),
  // Obrigatório: Pix e boleto exigem o CPF do pagador (payer.identification)
  // e agora o método só é escolhido no Payment Brick, então coletamos aqui.
  cpf: z
    .string()
    .min(1, 'Informe seu CPF')
    .refine((v) => v.replace(/\D/g, '').length === 11, 'CPF inválido'),
});
const addressSchema = z.object({
  cep: z.string().min(8, 'CEP inválido'),
  street: z.string().min(3, 'Endereço inválido'),
  number: z.string().min(1, 'Informe o número'),
  complement: z.string().optional(),
  district: z.string().min(2, 'Bairro inválido'),
  city: z.string().min(2, 'Cidade inválida'),
  state: z.string().min(2, 'UF inválida').max(2),
});

type Customer = z.infer<typeof customerSchema>;
export type CheckoutAddress = z.infer<typeof addressSchema>;
type Address = CheckoutAddress;

type ShippingMethod = ApiShippingMethod;
type ShippingPrices = Record<ShippingMethod, { price: number; label: string; deadline: string }>;

// O método de pagamento (cartão/Pix/boleto) é escolhido por abas na fase de
// pagamento (PaymentPhase), após criar o pedido — por isso não há passo
// "Pagamento" no wizard. Cartão usa o Card Payment Brick; Pix/boleto são
// chamadas diretas ao backend (Orders API, T17).
const steps = ['Cliente', 'Endereço', 'Entrega', 'Revisão'] as const;

export default function Checkout() {
  useSEO('Checkout');
  const navigate = useNavigate();
  const {
    items, appliedCoupon, clear,
    applyCoupon, removeCoupon, revalidateCoupon, couponLoading, couponError,
  } = useCartStore();
  const [couponCode, setCouponCode] = useState('');
  const products = useAdminDataStore((s) => s.products);
  const addOrder = useAdminDataStore((s) => s.addOrder);
  const loggedCustomer = useCurrentCustomer();

  const [step, setStep] = useState(0);
  const [customer, setCustomer] = useState<Customer | null>(
    loggedCustomer
      ? { name: loggedCustomer.name, email: loggedCustomer.email, phone: loggedCustomer.phone, cpf: '' }
      : null,
  );
  const [address, setAddress] = useState<Address | null>(
    loggedCustomer?.defaultAddress
      ? {
          cep: loggedCustomer.defaultAddress.cep,
          street: loggedCustomer.defaultAddress.street,
          number: loggedCustomer.defaultAddress.number,
          complement: loggedCustomer.defaultAddress.complement,
          district: loggedCustomer.defaultAddress.district,
          city: loggedCustomer.defaultAddress.city,
          state: loggedCustomer.defaultAddress.state,
        }
      : null,
  );
  const [shipping, setShipping] = useState<ShippingMethod>('PAC');
  // Opções de frete calculadas no backend (fonte única da regra).
  const [remoteShipping, setRemoteShipping] = useState<ShippingPrices | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Pedido criado (PENDING) aguardando pagamento pelo Payment Brick.
  const [createdOrder, setCreatedOrder] = useState<ApiOrder | null>(null);
  const [creatingOrder, setCreatingOrder] = useState(false);

  const freeShippingThreshold = useAdminDataStore((s) => s.settings.freeShippingThreshold);
  const subtotal = getCartSubtotal(items, products);
  const discount = getCartDiscount(subtotal, appliedCoupon);
  const cartShipping = getCartShipping(subtotal, appliedCoupon, freeShippingThreshold);

  // Revalida o cupom sempre que o subtotal mudar (remove se inválido).
  useEffect(() => {
    if (appliedCoupon && subtotal > 0) revalidateCoupon(subtotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal]);

  async function handleApplyCoupon() {
    if (!couponCode.trim()) return;
    const okApplied = await applyCoupon(couponCode, subtotal);
    if (okApplied) toast.success('Cupom aplicado!');
    setCouponCode('');
  }
  const freeShip = !!appliedCoupon?.freeShipping;

  useEffect(() => {
    if (subtotal <= 0) return;
    let cancelled = false;
    shippingService
      .getOptions(subtotal, freeShip)
      .then(({ options }) => {
        if (cancelled) return;
        const map = {} as ShippingPrices;
        for (const o of options) map[o.method] = { price: o.price, label: o.label, deadline: o.deadline };
        setRemoteShipping(map);
      })
      .catch(() => {
        if (!cancelled) setRemoteShipping(null); // cai na estimativa local abaixo
      });
    return () => {
      cancelled = true;
    };
  }, [subtotal, freeShip]);

  // Estimativa local só como fallback de exibição; o backend recalcula no pedido.
  const shippingPrices: ShippingPrices = remoteShipping ?? {
    PAC: { price: cartShipping, label: 'PAC', deadline: '5 a 8 dias úteis' },
    SEDEX: { price: freeShip ? 0 : cartShipping + 18, label: 'Sedex', deadline: '2 a 4 dias úteis' },
    PICKUP: { price: 0, label: 'Retirada na loja', deadline: 'Em até 1 dia útil' },
  };
  const finalShipping = shippingPrices[shipping].price;
  const total = subtotal - discount + finalShipping;

  if (items.length === 0 && !done && !createdOrder) {
    return (
      <div className="container-x py-16">
        <EmptyState
          title="Seu carrinho está vazio"
          description="Adicione produtos antes de finalizar a compra."
          action={<Link to="/loja" className="btn-primary">Ir para a loja</Link>}
        />
      </div>
    );
  }

  if (done) {
    return (
      <div className="container-x py-16">
        <div className="mx-auto max-w-xl text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <Check className="h-7 w-7" />
          </div>
          <h1 className="mt-5 font-display text-3xl font-bold">Pagamento aprovado!</h1>
          <p className="mt-3 text-ink-mute">
            Seu pedido <strong>{done}</strong> foi confirmado. Você acompanha o andamento em “Meus pedidos”.
          </p>
          <p className="mt-2 text-xs text-ink-mute">
            Enviamos a confirmação para o seu e-mail.
          </p>
          <div className="mt-7 flex justify-center gap-3">
            <Link to="/" className="btn-secondary">Voltar para a loja</Link>
            <Link to="/loja" className="btn-primary">Continuar comprando</Link>
          </div>
        </div>
      </div>
    );
  }

  // Passo 1 do fluxo de pagamento: cria o pedido (PENDING) e obtém o orderId.
  // Só depois disso o Payment Brick é renderizado (com o amount = total).
  async function handleCreateOrder() {
    if (!loggedCustomer) {
      toast.error('Faça login para finalizar a compra.');
      return;
    }
    if (!customer || !address) return;
    setCreatingOrder(true);
    try {
      const { order } = await orderService.create({
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        address: {
          recipientName: customer.name,
          phone: customer.phone,
          zipCode: address.cep,
          street: address.street,
          number: address.number,
          complement: address.complement ?? null,
          district: address.district,
          city: address.city,
          state: address.state,
          country: 'Brasil',
        },
        shippingMethod: shipping,
        couponCode: appliedCoupon?.code ?? null,
        // Placeholder: o método real é definido no Payment Brick e o backend
        // atualiza order.paymentMethod ao criar o pagamento (createPayment).
        paymentMethod: 'PIX',
        notes: null,
      });
      // Espelha no store admin e avança para a etapa de pagamento.
      addOrder(apiOrderToInternal(order));
      setCreatedOrder(order);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erro ao criar pedido.';
      toast.error(msg);
    } finally {
      setCreatingOrder(false);
    }
  }

  // Cartão aprovado (ou Pix confirmado no polling): pedido pago, limpa o carrinho.
  function handleApproved() {
    clear().catch(() => {});
    setDone(createdOrder?.id ?? null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Pix/boleto: o pedido já existe (PENDING). Limpamos o carrinho para o cliente
  // não recomprar os mesmos itens; a tela deixa explícito que aguarda pagamento.
  function handleOrderPlaced() {
    clear().catch(() => {});
  }

  return (
    <div className="container-x py-12">
      <p className="eyebrow">Finalizar pedido</p>
      <h1 className="section-title">Checkout</h1>

      {!loggedCustomer && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-line bg-bg-soft px-4 py-3 text-sm">
          <span className="text-ink-soft">
            Entre ou crie uma conta para acompanhar seus pedidos depois.
          </span>
          <span className="flex gap-2">
            <Link to="/login" className="text-xs font-bold text-ink hover:underline">Entrar</Link>
            <span className="text-ink-mute">·</span>
            <Link to="/criar-conta" className="text-xs font-bold text-ink hover:underline">Criar conta</Link>
          </span>
        </div>
      )}

      <ol className="mt-4 flex flex-wrap items-center gap-1 text-xs">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            <span
              className={`inline-flex h-6 items-center justify-center rounded-full px-2.5 font-semibold ${
                i <= step ? 'bg-ink text-bg' : 'bg-bg-soft text-ink-mute'
              }`}
            >
              {i + 1}. {s}
            </span>
            {i < steps.length - 1 && <ChevronRight className="h-3 w-3 text-ink-mute" />}
          </li>
        ))}
      </ol>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        <div className="card p-6">
          {step === 0 && (
            <CustomerStep
              defaults={customer ?? undefined}
              onNext={(d) => {
                setCustomer(d);
                setStep(1);
              }}
            />
          )}
          {step === 1 && (
            <AddressStep
              defaults={address ?? undefined}
              onBack={() => setStep(0)}
              onNext={(d) => {
                setAddress(d);
                setStep(2);
              }}
            />
          )}
          {step === 2 && (
            <ShippingStep
              prices={shippingPrices}
              value={shipping}
              setValue={setShipping}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && customer && address && !createdOrder && (
            <ReviewStep
              customer={customer}
              address={address}
              shipping={shippingPrices[shipping]}
              total={total}
              creating={creatingOrder}
              onBack={() => setStep(2)}
              onConfirm={handleCreateOrder}
            />
          )}
          {createdOrder && customer && address && (
            <PaymentPhase
              order={createdOrder}
              amount={createdOrder.total + createdOrder.paymentDiscount}
              payerEmail={customer.email}
              payerName={customer.name}
              payerCpf={customer.cpf}
              payerAddress={address}
              onApproved={handleApproved}
              onOrderPlaced={handleOrderPlaced}
            />
          )}
        </div>

        <aside className="card h-fit p-5">
          <h2 className="text-base font-bold">Resumo do pedido</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {items.map((it) => {
              const p = products.find((x) => x.id === it.productId);
              if (!p) return null;
              return (
                <li key={p.id + (it.variationId ?? '')} className="flex justify-between gap-2">
                  <span className="text-ink-mute">
                    {it.qty}x {p.name}
                  </span>
                  <span>{formatBRL((p.promoPrice ?? p.price) * it.qty)}</span>
                </li>
              );
            })}
          </ul>
          <dl className="mt-3 space-y-1.5 border-t border-ink-line pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-mute">Subtotal</dt>
              <dd>{formatBRL(subtotal)}</dd>
            </div>
            {appliedCoupon && (
              <div className="flex justify-between text-emerald-600">
                <dt>
                  Cupom {appliedCoupon.code}{' '}
                  <button onClick={removeCoupon} className="text-xs underline">remover</button>
                </dt>
                <dd>{appliedCoupon.freeShipping ? 'Frete grátis' : `-${formatBRL(discount)}`}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-mute">Frete</dt>
              <dd>{finalShipping === 0 ? 'Grátis' : formatBRL(finalShipping)}</dd>
            </div>
            <div className="mt-1 flex justify-between border-t border-ink-line pt-2 text-base font-bold">
              <dt>Total</dt>
              <dd>{formatBRL(total)}</dd>
            </div>
          </dl>

          {!appliedCoupon && (
            <div className="mt-4 border-t border-ink-line pt-4">
              <p className="label">Cupom de desconto</p>
              <div className="flex gap-2">
                <Input
                  placeholder="Ex: BLACK10"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleApplyCoupon()}
                />
                <Button variant="secondary" onClick={handleApplyCoupon} loading={couponLoading}>
                  Aplicar
                </Button>
              </div>
              {couponError && <p className="mt-2 text-[11px] text-rose-500">{couponError}</p>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function CustomerStep({ defaults, onNext }: { defaults?: Customer; onNext: (d: Customer) => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<Customer>({
    resolver: zodResolver(customerSchema),
    defaultValues: defaults,
  });
  const phoneReg = register('phone');
  const cpfReg = register('cpf');
  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-4">
      <h2 className="text-lg font-bold">Seus dados</h2>
      <div>
        <Label>Nome completo</Label>
        <Input {...register('name')} error={errors.name?.message} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>E-mail</Label>
          <Input type="email" {...register('email')} error={errors.email?.message} />
        </div>
        <div>
          <Label>Telefone / WhatsApp</Label>
          <Input
            {...phoneReg}
            inputMode="tel"
            placeholder="(54) 99999-9999"
            error={errors.phone?.message}
            onChange={(e) => {
              e.target.value = maskPhone(e.target.value);
              phoneReg.onChange(e);
            }}
          />
        </div>
      </div>
      <div>
        <Label>CPF</Label>
        <Input
          {...cpfReg}
          inputMode="numeric"
          placeholder="000.000.000-00"
          error={errors.cpf?.message}
          onChange={(e) => {
            e.target.value = maskCPF(e.target.value);
            cpfReg.onChange(e);
          }}
        />
        <p className="mt-1 text-[11px] text-ink-mute">Necessário para emitir Pix e boleto.</p>
      </div>
      <Button>Continuar para endereço</Button>
    </form>
  );
}

function AddressStep({ defaults, onBack, onNext }: { defaults?: Address; onBack: () => void; onNext: (d: Address) => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<Address>({
    resolver: zodResolver(addressSchema),
    defaultValues: defaults,
  });
  const cepReg = register('cep');
  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-4">
      <h2 className="text-lg font-bold">Endereço de entrega</h2>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>CEP</Label>
          <Input
            {...cepReg}
            inputMode="numeric"
            placeholder="00000-000"
            error={errors.cep?.message}
            onChange={(e) => {
              e.target.value = maskCEP(e.target.value);
              cepReg.onChange(e);
            }}
          />
        </div>
        <div className="col-span-2">
          <Label>Rua</Label>
          <Input {...register('street')} error={errors.street?.message} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Número</Label>
          <Input {...register('number')} error={errors.number?.message} />
        </div>
        <div className="col-span-2">
          <Label>Complemento</Label>
          <Input {...register('complement')} placeholder="opcional" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Bairro</Label>
          <Input {...register('district')} error={errors.district?.message} />
        </div>
        <div>
          <Label>Cidade</Label>
          <Input {...register('city')} error={errors.city?.message} />
        </div>
        <div>
          <Label>UF</Label>
          <Input {...register('state')} maxLength={2} error={errors.state?.message} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" type="button" onClick={onBack}>
          Voltar
        </Button>
        <Button type="submit">Continuar para entrega</Button>
      </div>
    </form>
  );
}

function ShippingStep({
  prices, value, setValue, onBack, onNext,
}: {
  prices: ShippingPrices;
  value: ShippingMethod;
  setValue: (v: ShippingMethod) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">Forma de entrega</h2>
      <div className="space-y-2">
        {(Object.keys(prices) as ShippingMethod[]).map((k) => {
          const p = prices[k];
          return (
            <label
              key={k}
              className={`flex cursor-pointer items-center justify-between rounded-xl border p-4 ${
                value === k ? 'border-ink bg-bg-soft' : 'border-ink-line'
              }`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  checked={value === k}
                  onChange={() => setValue(k)}
                  className="accent-ink"
                />
                <div>
                  <p className="font-semibold">{p.label}</p>
                  <p className="text-xs text-ink-mute">{p.deadline}</p>
                </div>
              </div>
              <span className="font-bold">{p.price === 0 ? 'Grátis' : formatBRL(p.price)}</span>
            </label>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onBack}>
          Voltar
        </Button>
        <Button onClick={onNext}>Continuar para pagamento</Button>
      </div>
    </div>
  );
}

function ReviewStep({
  customer, address, shipping, total, creating, onBack, onConfirm,
}: {
  customer: Customer;
  address: Address;
  shipping: { label: string; price: number; deadline: string };
  total: number;
  creating: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">Revise seu pedido</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-ink-line p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">Cliente</p>
          <p className="mt-1 text-sm font-semibold">{customer.name}</p>
          <p className="text-xs text-ink-mute">{customer.email}</p>
          <p className="text-xs text-ink-mute">{customer.phone}</p>
        </div>
        <div className="rounded-xl border border-ink-line p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">Endereço</p>
          <p className="mt-1 text-sm">
            {address.street}, {address.number} {address.complement && `(${address.complement})`}
          </p>
          <p className="text-xs text-ink-mute">
            {address.district}, {address.city}/{address.state} — {address.cep}
          </p>
        </div>
        <div className="rounded-xl border border-ink-line p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">Entrega</p>
          <p className="mt-1 text-sm font-semibold">{shipping.label}</p>
          <p className="text-xs text-ink-mute">{shipping.deadline}</p>
        </div>
        <div className="rounded-xl border border-ink-line p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">Pagamento</p>
          <p className="mt-1 text-sm font-semibold">Definido na próxima etapa</p>
          <p className="text-xs text-ink-mute">
            Cartão, Pix ou boleto — {formatBRL(total)}
          </p>
        </div>
      </div>
      <p className="text-xs text-ink-mute">
        Ao continuar, criamos seu pedido e abrimos o pagamento seguro do Mercado Pago
        (cartão, Pix ou boleto) aqui mesmo, sem sair do site.
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" type="button" onClick={onBack} disabled={creating}>
          Voltar
        </Button>
        <Button onClick={onConfirm} loading={creating}>Criar pedido e pagar</Button>
      </div>
    </div>
  );
}

type PaymentResult =
  | { kind: 'pix'; qrCode: string; qrCodeBase64: string; ticketUrl: string; amount?: number }
  | { kind: 'boleto'; url: string }
  | { kind: 'card_pending' };

/**
 * Injeta `payer.identification = { type: 'CPF', number }` no `formData` do Brick
 * quando ainda não veio um documento. Pix/boleto do Brick não coletam CPF, mas o
 * backend o exige; o cartão já pode trazer o seu, então só completamos o que
 * faltar. Retorna uma cópia — não muta o objeto do Brick. Não loga o CPF.
 */
function withPayerCpf(
  formData: Record<string, unknown>,
  cpf: string | undefined,
): Record<string, unknown> {
  const digits = (cpf ?? '').replace(/\D/g, '');
  const payer = { ...((formData.payer as Record<string, unknown>) ?? {}) };
  const current = payer.identification as { number?: unknown } | undefined;
  const hasDoc = typeof current?.number === 'string' && current.number.trim().length > 0;
  if (!hasDoc && digits.length === 11) {
    payer.identification = { type: 'CPF', number: digits };
  }
  return { ...formData, payer };
}

/** Normaliza o método vindo do Brick (camelCase/snake_case) para nosso domínio. */
function normalizeMethod(m: string): 'card' | 'pix' | 'boleto' | 'other' {
  if (['creditCard', 'credit_card', 'debitCard', 'debit_card', 'prepaidCard'].includes(m)) return 'card';
  if (m === 'bank_transfer' || m === 'pix') return 'pix';
  if (m === 'ticket' || m === 'atm' || m === 'boleto') return 'boleto';
  return 'other';
}

/**
 * Etapa de pagamento: o pedido já foi criado (PENDING). Mostra abas
 * Cartão | Pix | Boleto e trata o retorno do backend por método:
 *  - cartão aprovado  → tela de sucesso (via onApproved);
 *  - cartão recusado  → toast + rejeita a Promise (Brick permite nova tentativa);
 *  - Pix              → QR Code + copia-e-cola + link, com polling do status;
 *  - boleto           → link/botão do boleto; pedido segue PENDING.
 *
 * Cartão usa o **Card Payment Brick** (Orders API; ver PaymentBrick.tsx). Pix e
 * boleto são chamadas DIRETAS ao backend — não precisam de Brick. Isso remove a
 * dependência do Payment Brick combinado, que quebrava o cartão na Orders API.
 */
type PayMethod = 'card' | 'pix' | 'boleto';

export function PaymentPhase({
  order, amount, payerEmail, payerName, payerCpf, payerAddress, onApproved, onOrderPlaced,
}: {
  order: ApiOrder;
  amount: number;
  payerEmail: string;
  /** Nome do cliente; dividido em first/last name para o payer do MP. */
  payerName: string;
  /** CPF do cliente (com máscara); injetado no pagamento p/ Pix e boleto. */
  payerCpf?: string;
  /** Endereço do cliente; exigido pela Orders API no boleto (payer.address). */
  payerAddress: Address;
  onApproved: () => void;
  onOrderPlaced: () => void;
}) {
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [tab, setTab] = useState<PayMethod>('card');
  // Loading dos botões diretos de Pix/boleto (o cartão tem seu próprio botão no Brick).
  const [placing, setPlacing] = useState<PayMethod | null>(null);

  // Prévia do desconto do Pix (o backend aplica a MESMA regra ao gerar o Pix):
  // % do admin sobre os produtos já com cupom; frete não entra.
  const pixPercent = useAdminDataStore((s) => s.settings.pixDiscountPercent);
  const pixOff =
    pixPercent > 0
      ? Number(((Math.max(0, order.subtotal - order.discountValue) * pixPercent) / 100).toFixed(2))
      : 0;
  const pixAmount = Number((amount - pixOff).toFixed(2));

  // Polling leve enquanto exibe o Pix: confirma o pedido assim que o MP acusar pago.
  useEffect(() => {
    if (result?.kind !== 'pix') return;
    const id = window.setInterval(async () => {
      try {
        const s = await paymentService.getPaymentStatus(order.id);
        if (s.paymentStatus === 'PAID') onApproved();
      } catch {
        /* silencioso no polling */
      }
    }, 6000);
    return () => window.clearInterval(id);
  }, [result?.kind, order.id, onApproved]);

  // Monta o payer para Pix/boleto a partir dos dados já coletados no checkout.
  // O cartão traz o seu próprio payer via Card Payment Brick; aqui é só p/ os
  // métodos SEM Brick. `withPayerCpf` completa o CPF quando faltar.
  function buildDirectPayer(): Record<string, unknown> {
    const digits = (payerCpf ?? '').replace(/\D/g, '');
    const parts = payerName.trim().split(/\s+/);
    const firstName = parts[0] ?? '';
    const lastName = parts.slice(1).join(' ');
    const payer: Record<string, unknown> = {
      email: payerEmail,
      identification: { type: 'CPF', number: digits },
    };
    if (firstName) payer.first_name = firstName;
    if (lastName) payer.last_name = lastName;
    return payer;
  }

  // Endereço do pagador no shape que a Orders API espera (backend remapeia UF).
  function buildPayerAddress(): Record<string, unknown> {
    return {
      zip_code: payerAddress.cep.replace(/\D/g, ''),
      street_name: payerAddress.street,
      street_number: payerAddress.number,
      neighborhood: payerAddress.district,
      city: payerAddress.city,
      state: payerAddress.state,
    };
  }

  async function handlePix() {
    if ((payerCpf ?? '').replace(/\D/g, '').length !== 11) {
      toast.error('Informe um CPF válido para gerar o Pix.');
      return;
    }
    setPlacing('pix');
    try {
      await submitPayment({
        selectedPaymentMethod: 'bank_transfer',
        formData: { payment_method_id: 'pix', payer: buildDirectPayer() },
      });
    } catch {
      /* erro já sinalizado por toast em submitPayment */
    } finally {
      setPlacing(null);
    }
  }

  async function handleBoleto() {
    if ((payerCpf ?? '').replace(/\D/g, '').length !== 11) {
      toast.error('Informe um CPF válido para gerar o boleto.');
      return;
    }
    setPlacing('boleto');
    try {
      await submitPayment({
        selectedPaymentMethod: 'ticket',
        formData: {
          payment_method_id: 'boleto',
          payer: { ...buildDirectPayer(), address: buildPayerAddress() },
        },
      });
    } catch {
      /* erro já sinalizado por toast em submitPayment */
    } finally {
      setPlacing(null);
    }
  }

  async function submitPayment({ selectedPaymentMethod, formData }: PaymentBrickSubmit) {
    try {
      // Garante payer.identification (CPF) em TODOS os métodos. O Brick do Pix
      // coleta só e-mail; sem o CPF o backend rejeita Pix/boleto (400). Se o
      // Brick já mandou um documento (cartão), preservamos; senão completamos
      // com o CPF coletado na etapa de dados do cliente.
      const filledFormData = withPayerCpf(formData, payerCpf);
      const res = await paymentService.createPayment(order.id, {
        selectedPaymentMethod,
        formData: filledFormData,
      });
      const method = normalizeMethod(selectedPaymentMethod);

      if (method === 'card') {
        const card = res as ApiCardPaymentResult;
        if (card.status === 'approved') {
          onApproved();
          return;
        }
        if (card.status === 'rejected') {
          toast.error('Pagamento recusado. Revise os dados ou tente outro cartão/método.');
          throw new Error('payment_rejected'); // mantém o Brick para nova tentativa
        }
        setResult({ kind: 'card_pending' });
        return;
      }

      if (method === 'pix') {
        const pix = res as ApiPixPaymentResult;
        setResult({
          kind: 'pix',
          qrCode: pix.qr_code,
          qrCodeBase64: pix.qr_code_base64,
          ticketUrl: pix.ticket_url,
          amount: pix.amount,
        });
        onOrderPlaced();
        return;
      }

      if (method === 'boleto') {
        const bol = res as ApiBoletoPaymentResult;
        setResult({ kind: 'boleto', url: bol.external_resource_url });
        onOrderPlaced();
        return;
      }
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      throw err; // rejeita a Promise: o Brick sinaliza a falha e permite retry
    }
  }

  async function handleManualCheck() {
    setChecking(true);
    try {
      const s = await paymentService.getPaymentStatus(order.id);
      if (s.paymentStatus === 'PAID') {
        onApproved();
      } else if (s.paymentStatus === 'FAILED' || s.paymentStatus === 'CANCELED') {
        toast.error('Pagamento não concluído. Tente novamente.');
      } else {
        toast('Pagamento ainda pendente. Assim que cair, confirmamos seu pedido.');
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível checar o status.');
    } finally {
      setChecking(false);
    }
  }

  async function copyPix(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Código Pix copiado!');
    } catch {
      toast.error('Não foi possível copiar. Copie manualmente.');
    }
  }

  // ----- telas de resultado por método -----
  if (result?.kind === 'pix') {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold">Pague com Pix</h2>
        <p className="text-sm text-ink-mute">
          Pedido <strong>{order.id}</strong> criado. Escaneie o QR Code no app do seu banco ou use o
          copia-e-cola. Seu pedido é confirmado automaticamente assim que o pagamento cair.
        </p>
        {result.amount !== undefined && (
          <p className="text-center text-2xl font-bold tabular-nums">{formatBRL(result.amount)}</p>
        )}
        {result.qrCodeBase64 && (
          <img
            src={`data:image/png;base64,${result.qrCodeBase64}`}
            alt="QR Code Pix"
            className="mx-auto h-56 w-56 rounded-xl border border-ink-line bg-white p-2"
          />
        )}
        <div>
          <Label>Pix copia-e-cola</Label>
          <div className="flex gap-2">
            <Input readOnly value={result.qrCode} className="font-mono text-xs" />
            <Button variant="secondary" type="button" onClick={() => copyPix(result.qrCode)}>
              <Copy className="h-4 w-4" /> Copiar
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" loading={checking} onClick={handleManualCheck}>
            Já paguei / atualizar status
          </Button>
          {result.ticketUrl && (
            <a href={result.ticketUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">
              Abrir página do Pix <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
    );
  }

  if (result?.kind === 'boleto') {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold">Boleto gerado</h2>
        <p className="text-sm text-ink-mute">
          Pedido <strong>{order.id}</strong> criado. Ele fica pendente até a compensação do boleto
          (pode levar até 3 dias úteis). Abra o boleto para pagar ou imprimir.
        </p>
        <div className="flex flex-wrap gap-2">
          {result.url && (
            <a href={result.url} target="_blank" rel="noopener noreferrer" className="btn-primary">
              Abrir boleto <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <Button variant="secondary" type="button" loading={checking} onClick={handleManualCheck}>
            Atualizar status
          </Button>
        </div>
      </div>
    );
  }

  if (result?.kind === 'card_pending') {
    return (
      <div className="space-y-4">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <Clock className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-bold">Pagamento em processamento</h2>
        <p className="text-sm text-ink-mute">
          Estamos aguardando a confirmação do seu pagamento para o pedido <strong>{order.id}</strong>.
          Você pode atualizar o status abaixo.
        </p>
        <Button type="button" loading={checking} onClick={handleManualCheck}>
          Atualizar status
        </Button>
      </div>
    );
  }

  // ----- seleção de método + formulário/ações por método -----
  const tabs: { key: PayMethod; label: string }[] = [
    { key: 'card', label: 'Cartão' },
    { key: 'pix', label: 'Pix' },
    { key: 'boleto', label: 'Boleto' },
  ];
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">Pagamento</h2>
      <p className="text-sm text-ink-mute">
        Pedido <strong>{order.id}</strong> criado. Escolha como pagar — cartão, Pix ou boleto — sem
        sair do site.
      </p>

      <div className="flex gap-2" role="tablist" aria-label="Forma de pagamento">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
              tab === t.key ? 'border-ink bg-ink text-bg' : 'border-ink-line text-ink-soft hover:border-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'card' && (
        <div>
          <CardPaymentBrick
            amount={amount}
            payerEmail={payerEmail}
            onSubmit={(formData) =>
              submitPayment({ selectedPaymentMethod: 'credit_card', formData })
            }
            onError={(e) => console.error('[CardPaymentBrick]', e)}
          />
        </div>
      )}

      {tab === 'pix' && (
        <div className="space-y-3">
          {pixOff > 0 && (
            <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">
              Total no Pix: <strong>{formatBRL(pixAmount)}</strong>{' '}
              (economia de {formatBRL(pixOff)} — {pixPercent}% nos produtos)
            </p>
          )}
          <p className="text-sm text-ink-mute">
            Geramos um QR Code e o copia-e-cola. Seu pedido é confirmado automaticamente assim que o
            pagamento cair.
          </p>
          <Button type="button" loading={placing === 'pix'} onClick={handlePix}>
            Gerar Pix
          </Button>
        </div>
      )}

      {tab === 'boleto' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-mute">
            Geramos o boleto para pagar ou imprimir. O pedido fica pendente até a compensação (pode
            levar até 3 dias úteis).
          </p>
          <Button type="button" loading={placing === 'boleto'} onClick={handleBoleto}>
            Gerar boleto
          </Button>
        </div>
      )}
    </div>
  );
}
