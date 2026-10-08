import { z } from 'zod';

/**
 * Métodos de pagamento aceitos, já normalizados para o nosso domínio.
 * O Payment Brick manda `selectedPaymentMethod` como `credit_card`,
 * `debit_card`, `bank_transfer` (Pix) ou `ticket` (boleto). Também dá para
 * inferir pelo `formData.payment_method_id` (`pix`, `bolbradesco`, ...).
 */
export type PaymentKind = 'credit_card' | 'pix' | 'boleto';

/** Documento do pagador (CPF/CNPJ) — exigido em Pix e boleto. */
const identificationSchema = z.object({
  type: z.string().trim().min(1),
  number: z.string().trim().min(1),
});

/**
 * Endereço do pagador (exigido no boleto pela Orders API).
 *
 * A UF pode chegar em DOIS nomes: a Orders API espera `state`, mas o Payment
 * Brick / Payments API antiga manda `federal_unit`. Aceitamos ambos aqui —
 * `z.object` descarta chaves não declaradas, então declarar só um perderia a UF
 * enviada com o outro nome. O remapeamento para `state` (e o descarte de
 * `federal_unit`, que o MP recusa) acontece no service, ao montar o body.
 */
const payerAddressSchema = z
  .object({
    zip_code: z.string().trim().optional(),
    street_name: z.string().trim().optional(),
    street_number: z.coerce.string().optional(),
    neighborhood: z.string().trim().optional(),
    city: z.string().trim().optional(),
    state: z.string().trim().optional(),
    federal_unit: z.string().trim().optional(),
  })
  .optional();

const payerSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail do pagador inválido.'),
  first_name: z.string().trim().optional(),
  last_name: z.string().trim().optional(),
  identification: identificationSchema.optional(),
  address: payerAddressSchema,
});

/**
 * `formData` como o Payment Brick entrega no `onSubmit`. Cartão inclui `token`
 * e `issuer_id`; Pix/boleto não. `transaction_amount` é ignorado no backend
 * (o valor real vem sempre do pedido — nunca do cliente).
 *
 * `issuer_id` continua aceito (o Brick envia), mas NÃO é repassado à Orders API
 * — ela rejeita esse campo (HTTP 400, confirmado em sandbox T10); o MP infere o
 * emissor pelo `token`.
 */
const formDataSchema = z.object({
  token: z.string().trim().min(1).optional(),
  issuer_id: z.union([z.string(), z.number()]).optional(),
  payment_method_id: z.string().trim().min(1).optional(),
  installments: z.coerce.number().int().positive().optional(),
  transaction_amount: z.coerce.number().optional(),
  payer: payerSchema,
});

/**
 * Resolve o método normalizado a partir do `selectedPaymentMethod` do Brick
 * ou, como fallback, do `payment_method_id` do `formData`.
 */
export function resolvePaymentKind(
  selectedPaymentMethod: string | undefined,
  paymentMethodId: string | undefined,
): PaymentKind | null {
  const sel = selectedPaymentMethod?.toLowerCase();
  if (sel === 'credit_card' || sel === 'debit_card') return 'credit_card';
  if (sel === 'bank_transfer' || sel === 'pix') return 'pix';
  if (sel === 'ticket' || sel === 'boleto') return 'boleto';

  const pm = paymentMethodId?.toLowerCase();
  if (pm === 'pix') return 'pix';
  if (pm && (pm.startsWith('bol') || pm.startsWith('pec'))) return 'boleto';
  if (pm) return 'credit_card';
  return null;
}

/**
 * Body de `POST /orders/:orderId/payments`. Espelha o payload que o front
 * monta no `onSubmit` do Brick: `{ selectedPaymentMethod, formData }`.
 * O `orderId` vem pela URL, não pelo corpo.
 */
export const createPaymentSchema = z
  .object({
    selectedPaymentMethod: z.string().trim().min(1).optional(),
    formData: formDataSchema,
  })
  .superRefine((data, ctx) => {
    const kind = resolvePaymentKind(
      data.selectedPaymentMethod,
      data.formData.payment_method_id,
    );
    if (!kind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Não foi possível determinar o método de pagamento (selectedPaymentMethod ou payment_method_id).',
        path: ['selectedPaymentMethod'],
      });
      return;
    }
    if (kind === 'credit_card' && !data.formData.token) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Pagamento com cartão exige um token do Brick.',
        path: ['formData', 'token'],
      });
    }
    if ((kind === 'pix' || kind === 'boleto') && !data.formData.payer.identification) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Pix e boleto exigem payer.identification (CPF/CNPJ).',
        path: ['formData', 'payer', 'identification'],
      });
    }
  });

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
