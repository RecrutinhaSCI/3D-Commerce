import { z } from 'zod';
import { OrderStatus, PaymentMethod, PaymentStatus, ShippingMethod } from '@prisma/client';
import { isValidCpf, onlyDigits } from '../../utils/cpf';

/** Endereço enviado no checkout — vira snapshot em `Order.addressSnapshot`. */
export const orderAddressSchema = z.object({
  recipientName: z.string().trim().min(2, 'Nome do destinatário é obrigatório.'),
  phone: z.string().trim().min(8, 'Telefone inválido.'),
  zipCode: z.string().trim().min(4, 'CEP inválido.'),
  street: z.string().trim().min(2, 'Rua inválida.'),
  number: z.string().trim().min(1, 'Número obrigatório.'),
  complement: z.string().trim().optional().nullable(),
  district: z.string().trim().min(2, 'Bairro inválido.'),
  city: z.string().trim().min(2, 'Cidade inválida.'),
  state: z.string().trim().min(2, 'UF inválida.').max(2, 'UF inválida.'),
  country: z.string().trim().min(2).default('Brasil'),
});
export type OrderAddressInput = z.infer<typeof orderAddressSchema>;

export const createOrderSchema = z.object({
  customerName: z.string().trim().min(2, 'Nome do cliente é obrigatório.'),
  customerEmail: z.string().trim().toLowerCase().email('E-mail inválido.'),
  customerPhone: z.string().trim().min(8, 'Telefone inválido.'),
  // CPF (opcional na API para compat; o checkout sempre envia). Guardado só
  // com dígitos; validado pelos dígitos verificadores.
  customerCpf: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((v) => !v || isValidCpf(v), 'CPF inválido.')
    .transform((v) => (v ? onlyDigits(v) : null)),
  address: orderAddressSchema,
  // Modalidade de entrega — o VALOR é calculado no backend (shipping.service).
  shippingMethod: z
    .nativeEnum(ShippingMethod, {
      errorMap: () => ({ message: 'shippingMethod deve ser PAC, SEDEX ou PICKUP.' }),
    })
    .default(ShippingMethod.PAC),
  // Mantido por compat, porém IGNORADO: o frete nunca vem do cliente.
  shippingValue: z.coerce.number().min(0).optional(),
  // Cupom (opcional). O DESCONTO é sempre recalculado no backend a partir do
  // cupom — o cliente não define o valor do desconto.
  couponCode: z
    .string()
    .trim()
    .max(40)
    .transform((v) => v.toUpperCase())
    .optional()
    .nullable(),
  // Mantido por compat, porém IGNORADO no serviço (backend é a fonte da verdade).
  discountValue: z.coerce.number().min(0).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod, {
    errorMap: () => ({ message: 'paymentMethod deve ser PIX, CREDIT_CARD ou BOLETO.' }),
  }),
  notes: z.string().trim().max(1000).optional().nullable(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderStatusSchema = z
  .object({
    status: z.nativeEnum(OrderStatus).optional(),
    paymentStatus: z.nativeEnum(PaymentStatus).optional(),
  })
  .refine((v) => v.status !== undefined || v.paymentStatus !== undefined, {
    message: 'Envie ao menos um: status ou paymentStatus.',
  });
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

/** Código de rastreio da transportadora. String vazia limpa o código. */
export const updateOrderTrackingSchema = z.object({
  trackingCode: z
    .string()
    .trim()
    .max(60, 'Código de rastreio muito longo.')
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
});
export type UpdateOrderTrackingInput = z.infer<typeof updateOrderTrackingSchema>;

const parseBool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true'))
  .optional();

/** Query pública de "meus pedidos". */
export const meOrdersQuerySchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type MeOrdersQuery = z.infer<typeof meOrdersQuerySchema>;

/** Query admin — inclui filtros extras + search. */
export const adminOrdersQuerySchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  paymentStatus: z.nativeEnum(PaymentStatus).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  couponCode: z.string().trim().toUpperCase().max(40).optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['newest', 'oldest', 'total_asc', 'total_desc']).default('newest'),
});
export type AdminOrdersQuery = z.infer<typeof adminOrdersQuerySchema>;
export { parseBool };
