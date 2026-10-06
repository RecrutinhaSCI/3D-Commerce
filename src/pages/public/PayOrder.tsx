import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { AlertCircle, Check } from 'lucide-react';
import { useCurrentCustomer } from '@/store/useCustomerAuthStore';
import { orderService } from '@/services/orderService';
import { loginUrl } from '@/utils/redirect';
import { ApiError } from '@/services/api';
import type { ApiOrder } from '@/services/types';
import { Input, Label } from '@/components/ui/Input';
import { formatBRL } from '@/utils/price';
import { maskCPF } from '@/utils/masks';
import { isValidCpf } from '@/utils/cpf';
import { useSEO } from '@/utils/seo';
import { PaymentPhase, type CheckoutAddress } from './Checkout';

/**
 * Pagar um pedido PENDENTE depois (vem do "Pagar agora" em Meus pedidos).
 * Reaproveita a fase de pagamento do checkout: cartão, novo Pix ou boleto.
 * Gerar um novo pagamento cancela a cobrança anterior em aberto no backend.
 */
export default function PayOrder() {
  useSEO('Pagar pedido');
  const { orderId = '' } = useParams();
  const customer = useCurrentCustomer();
  const [order, setOrder] = useState<ApiOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cpf, setCpf] = useState('');
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    if (!customer || !orderId) return;
    orderService
      .getMine(orderId)
      .then(({ order: o }) => {
        setOrder(o);
        if (o.customerCpf) setCpf(maskCPF(o.customerCpf));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Não foi possível carregar o pedido.'));
  }, [customer?.id, orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!customer) return <Navigate to={loginUrl(`/pagar/${orderId}`)} replace />;

  if (paid) {
    return (
      <div className="container-x py-16">
        <div className="mx-auto max-w-xl text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <Check className="h-7 w-7" />
          </div>
          <h1 className="mt-5 font-display text-3xl font-bold">Pagamento aprovado!</h1>
          <p className="mt-3 text-ink-mute">Seu pedido foi confirmado. Enviamos a confirmação para o seu e-mail.</p>
          <Link to="/meus-pedidos" className="btn-primary mt-7 inline-flex">Ver meus pedidos</Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container-x py-16">
        <div className="mx-auto flex max-w-xl items-start gap-2 rounded-xl bg-rose-50 p-4 text-sm text-rose-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>{error}</p>
            <Link to="/meus-pedidos" className="mt-1 inline-block font-semibold underline">Voltar para meus pedidos</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!order) {
    return <div className="container-x py-16"><div className="mx-auto card h-40 max-w-xl animate-pulse bg-bg-soft" /></div>;
  }

  const payable =
    order.status === 'PENDING' && ['PENDING', 'FAILED', 'CANCELED'].includes(order.paymentStatus);
  if (!payable) {
    return (
      <div className="container-x py-16 text-center">
        <p className="text-ink-mute">
          {order.paymentStatus === 'PAID' ? 'Este pedido já está pago.' : 'Este pedido não aceita mais pagamento.'}
        </p>
        <Link to="/meus-pedidos" className="btn-secondary mt-5 inline-flex">Voltar para meus pedidos</Link>
      </div>
    );
  }

  const a = order.addressSnapshot;
  const address: CheckoutAddress = {
    cep: a.zipCode,
    street: a.street,
    number: a.number,
    complement: a.complement ?? undefined,
    district: a.district,
    city: a.city,
    state: a.state,
  };
  const cpfOk = isValidCpf(cpf);

  return (
    <div className="container-x py-12">
      <p className="eyebrow">Meus pedidos</p>
      <h1 className="section-title">Pagar pedido</h1>
      <p className="mt-2 text-sm text-ink-mute">
        Pedido <strong>{order.id}</strong> · {order.items.length} item(s) · total {formatBRL(order.total + order.paymentDiscount)}
      </p>

      <div className="mt-6 card max-w-2xl p-6">
        <div className="mb-5">
          <Label>CPF do pagador (obrigatório para Pix e boleto)</Label>
          <Input
            value={cpf}
            onChange={(e) => setCpf(maskCPF(e.target.value))}
            placeholder="000.000.000-00"
            inputMode="numeric"
          />
        </div>
        <PaymentPhase
          order={order}
          amount={order.total + order.paymentDiscount}
          payerEmail={order.customerEmail}
          payerName={order.customerName}
          payerCpf={cpfOk ? cpf : undefined}
          payerAddress={address}
          onApproved={() => setPaid(true)}
          onOrderPlaced={() => {}}
        />
      </div>
    </div>
  );
}
