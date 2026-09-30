import { MercadoPagoConfig } from 'mercadopago';
import { env } from '../config/env';

/**
 * Client compartilhado do Mercado Pago (SDK v2).
 *
 * Inicializado uma única vez a partir do `MP_ACCESS_TOKEN`. Os módulos de
 * pagamento (Payment, etc.) recebem este client no construtor:
 *
 *   import { Payment } from 'mercadopago';
 *   import { mercadopago } from '../lib/mercadopago';
 *   const payment = new Payment(mercadopago);
 *
 * O access token nunca deve ir ao frontend — lá só a MP_PUBLIC_KEY.
 */
export const mercadopago = new MercadoPagoConfig({
  accessToken: env.MP_ACCESS_TOKEN,
  options: { timeout: 5000 },
});
