import 'dotenv/config';
import crypto from 'node:crypto';
import { MercadoPagoConfig, Order } from 'mercadopago';
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN, options: { timeout: 8000 } });
const order = new Order(client);
console.log('methods:', ['create','get','process','cancel','refund'].map(m => `${m}:${typeof order[m]}`).join(' '));
// create a pix order via SDK, then get it
const created = await order.create({
  body: { type:'online', processing_mode:'automatic', external_reference:`SDK-${Date.now()}`, total_amount:'10.00',
    payer:{ email:'test_user_apro@testuser.com', identification:{type:'CPF',number:'12345678909'} },
    transactions:{ payments:[{ amount:'10.00', payment_method:{ id:'pix', type:'bank_transfer' }, expiration_time:'P1D' }] } },
  requestOptions: { idempotencyKey: crypto.randomUUID() },
});
console.log('SDK create OK -> id', created.id, '| status', created.status, '| pm has qr_code?', !!created.transactions?.payments?.[0]?.payment_method?.qr_code);
const got = await order.get({ id: created.id });
console.log('SDK get OK    -> id', got.id, '| status', got.status, '| detail', got.status_detail);
