import { api } from './api';
import type { ApiCreatePaymentResult, ApiPaymentStatusResult } from './types';

/**
 * Payload enviado ao backend a partir do onSubmit do Payment Brick.
 * O Brick tokeniza o cartão — aqui só repassamos `selectedPaymentMethod` e o
 * `formData` (que já vem no shape de payment.create do MP). Nenhum dado de
 * cartão em claro passa pelo nosso código.
 */
export interface CreatePaymentPayload {
  selectedPaymentMethod: string;
  formData: Record<string, unknown>;
}

export const paymentService = {
  /** Cria o pagamento do pedido no Mercado Pago (via backend). */
  createPayment(orderId: string, body: CreatePaymentPayload) {
    return api.post<ApiCreatePaymentResult>(`/api/orders/${orderId}/payments`, body);
  },
  /** Consulta o status atual do pagamento do pedido (para polling do Pix/boleto). */
  getPaymentStatus(orderId: string) {
    return api.get<ApiPaymentStatusResult>(`/api/orders/${orderId}/payments/status`);
  },
};
