import { CardPayment, initMercadoPago } from '@mercadopago/sdk-react';

/**
 * Wrapper do **Card Payment Brick** (Checkout Transparente do Mercado Pago).
 * Isola o SDK: o resto do app fala só com esta interface, sem conhecer os
 * tipos internos do `@mercadopago/sdk-react`.
 *
 * Por que só o cartão usa Brick (T17): a app é de **Orders API**. O Payment
 * Brick COMBINADO (`<Payment>`) fazia a busca de BIN em
 * `processing_mode=aggregator`, incompatível com a Orders API — o cartão
 * falhava com `no_payment_method_for_provided_bin` dentro do iframe do MP. A
 * doc oficial recomenda o **Card Payment Brick** (`cardPayment`) para cartão na
 * Orders API. Pix e boleto NÃO precisam de Brick: são chamadas diretas ao
 * backend (ver `PaymentPhase` em `Checkout.tsx`).
 *
 * Regra de segurança: só a PUBLIC KEY vai ao front (via VITE_MP_PUBLIC_KEY).
 * O Brick tokeniza o cartão no browser; nós apenas repassamos o `formData`.
 */

// initMercadoPago é idempotente do nosso lado: só chamamos uma vez por sessão.
let initialized = false;
export function ensureMpInit() {
  if (initialized) return;
  const publicKey = import.meta.env.VITE_MP_PUBLIC_KEY;
  if (!publicKey) {
    // Sem chave configurada o Brick não renderiza; deixamos claro no console.
    console.warn('[PaymentBrick] VITE_MP_PUBLIC_KEY não configurada.');
    return;
  }
  initMercadoPago(publicKey, { locale: 'pt-BR' });
  initialized = true;
}

export interface PaymentBrickSubmit {
  /** 'credit_card' | 'bank_transfer' (Pix) | 'ticket' (boleto). */
  selectedPaymentMethod: string;
  /** Dados prontos p/ payment.create (token, installments, payer, etc.). */
  formData: Record<string, unknown>;
}

interface CardPaymentBrickProps {
  /** Total do pedido (obrigatório para o Brick). */
  amount: number;
  /** E-mail do pagador para pré-preencher o formulário. */
  payerEmail?: string;
  /**
   * Chamado quando o cliente envia o cartão. O `formData` já vem no shape de
   * payment.create do MP (token, payment_method_id, installments, issuer_id,
   * payer). Deve resolver a Promise para o Brick concluir, ou rejeitá-la para
   * manter o formulário (ex.: cartão recusado → cliente tenta de novo).
   */
  onSubmit: (formData: Record<string, unknown>) => Promise<void>;
  onError?: (error: unknown) => void;
  onReady?: () => void;
}

/**
 * Card Payment Brick — só cartão (crédito/débito). O `onSubmit` do Brick devolve
 * `{ token, issuer_id, payment_method_id, installments, payer }`; repassamos
 * como `Record<string, unknown>` para o chamador montar o payload do backend.
 */
export function CardPaymentBrick({ amount, payerEmail, onSubmit, onError, onReady }: CardPaymentBrickProps) {
  ensureMpInit();

  return (
    <CardPayment
      initialization={{
        amount,
        payer: payerEmail ? { email: payerEmail } : undefined,
      }}
      onSubmit={(formData) => onSubmit(formData as unknown as Record<string, unknown>)}
      onReady={onReady}
      onError={(error) => onError?.(error)}
    />
  );
}

/*
 * PROPOSTA DE REMOÇÃO (T17) — Payment Brick COMBINADO.
 *
 * Substituído pelo Card Payment Brick acima + chamadas diretas de Pix/boleto.
 * O componente combinado abaixo é INCOMPATÍVEL com a Orders API (buscava BIN em
 * processing_mode=aggregator → `no_payment_method_for_provided_bin` no cartão).
 * Mantido comentado por ora; pode ser apagado em limpeza futura.
 *
 * import { Payment } from '@mercadopago/sdk-react';
 *
 * export function PaymentBrick({ amount, payerEmail, onSubmit, onError, onReady }) {
 *   ensureMpInit();
 *   return (
 *     <Payment
 *       initialization={{ amount, payer: payerEmail ? { email: payerEmail } : undefined }}
 *       customization={{ paymentMethods: { creditCard: 'all', bankTransfer: 'all', ticket: 'all' } }}
 *       onSubmit={({ selectedPaymentMethod, formData }) =>
 *         onSubmit({
 *           selectedPaymentMethod: String(selectedPaymentMethod),
 *           formData: formData as unknown as Record<string, unknown>,
 *         })
 *       }
 *       onReady={onReady}
 *       onError={(error) => onError?.(error)}
 *     />
 *   );
 * }
 */
