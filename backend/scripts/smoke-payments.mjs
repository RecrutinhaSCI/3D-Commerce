/**
 * Smoke E2E do fluxo de pagamentos MOCK (R19).
 * Fluxo: registra cliente → carrinho → pedido PIX → cobrança → idempotência
 * de criação → simula aprovado → pedido PAID/CONFIRMED → replay de webhook
 * → expirado/cancelado → validações de segurança do webhook.
 */
// Como rodar: backend no ar (`npm run dev`) e então `node scripts/smoke-payments.mjs`.
// Se PAYMENT_WEBHOOK_SECRET estiver setado no backend/.env, exporte o mesmo
// valor antes de rodar; sem setar, ambos usam o default de desenvolvimento.
import { createHmac } from 'node:crypto';

const API = process.env.API_URL ?? 'http://localhost:3333/api';
const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-mock-webhook-secret-local-only';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  OK  ${name}`); }
  else { failed++; console.log(`FALHOU ${name} ${extra}`); }
}

async function req(method, path, { token, body, headers = {}, raw } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(raw ? {} : { 'content-type': 'application/json' }),
      ...(raw ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const sign = (buf) => createHmac('sha256', SECRET).update(buf).digest('hex');

// --- 1. Cliente ---
const email = `smoke.r19.${Date.now()}@teste.com`;
let r = await req('POST', '/auth/register', {
  body: { name: 'Smoke R19', email, password: 'senha12345' },
});
check('registro do cliente', r.status === 201 || r.status === 200, `status=${r.status}`);
const token = r.json?.data?.token;
check('token recebido', !!token);

// --- 2. Carrinho ---
r = await req('GET', '/public/products?limit=5');
const prod = r.json?.data?.products?.find((p) => p.stock > 2 && p.purchaseMode !== 'QUOTE');
check('produto disponível no catálogo', !!prod);
r = await req('POST', '/cart/items', { token, body: { productId: prod.id, quantity: 1 } });
check('item no carrinho', r.status === 200 || r.status === 201, `status=${r.status}`);

// --- 3. Pedido PIX ---
const addr = {
  recipientName: 'Smoke R19', phone: '54999990000', zipCode: '95000-000',
  street: 'Rua Teste', number: '100', district: 'Centro', city: 'Caxias do Sul',
  state: 'RS', country: 'Brasil',
};
r = await req('POST', '/orders', {
  token,
  body: {
    customerName: 'Smoke R19', customerEmail: email, customerPhone: '54999990000',
    address: addr, shippingValue: 20, paymentMethod: 'PIX',
  },
});
check('pedido criado', r.status === 201, `status=${r.status} ${JSON.stringify(r.json?.error ?? '')}`);
const order = r.json?.data?.order;
check('pedido PENDING/PENDING', order?.status === 'PENDING' && order?.paymentStatus === 'PENDING');

// --- 4. Cobrança Pix ---
r = await req('POST', `/orders/${order.id}/payments`, { token });
check('cobrança criada (201)', r.status === 201, `status=${r.status} ${JSON.stringify(r.json)}`);
const pay = r.json?.data;
check('txid formato Bacen', /^[A-Z0-9]{26,35}$/.test(pay?.txid ?? ''));
check('copia-e-cola EMV presente', (pay?.pixCopyPaste ?? '').startsWith('000201'));
check('QR = copia-e-cola', pay?.qrCodeText === pay?.pixCopyPaste);
check('valor = total do pedido', pay?.amount === order.total, `${pay?.amount} vs ${order.total}`);
check('expiração futura', new Date(pay?.expiresAt) > new Date());
check('status PENDING', pay?.status === 'PENDING');

// --- 5. Idempotência da criação ---
r = await req('POST', `/orders/${order.id}/payments`, { token });
check('segunda chamada reusa cobrança (200 + reused)', r.status === 200 && r.json?.meta?.reused === true && r.json?.data?.id === pay.id);

// --- 6. Segurança do webhook ---
const evtBody = JSON.stringify({ eventId: `evt_smoke_${Date.now()}`, txid: pay.txid, type: 'pix.approved' });
r = await req('POST', '/webhooks/payments/mock', { raw: evtBody });
check('webhook sem assinatura → 401', r.status === 401, `status=${r.status}`);
r = await req('POST', '/webhooks/payments/mock', {
  raw: evtBody, headers: { 'x-webhook-signature': 'a'.repeat(64) },
});
check('webhook assinatura errada → 401', r.status === 401, `status=${r.status}`);
r = await req('POST', '/webhooks/payments/inter', {
  raw: evtBody, headers: { 'x-webhook-signature': sign(Buffer.from(evtBody)) },
});
check('webhook provider INTER → 501 (stub)', r.status === 501, `status=${r.status}`);

// --- 7. Webhook válido aprova + replay idempotente ---
r = await req('POST', '/webhooks/payments/mock', {
  raw: evtBody, headers: { 'x-webhook-signature': sign(Buffer.from(evtBody)) },
});
check('webhook válido aplicado', r.status === 200 && r.json?.data?.applied === true, JSON.stringify(r.json));
r = await req('POST', '/webhooks/payments/mock', {
  raw: evtBody, headers: { 'x-webhook-signature': sign(Buffer.from(evtBody)) },
});
check('replay mesmo eventId → duplicate, não reaplica', r.status === 200 && r.json?.data?.duplicate === true && r.json?.data?.applied === false);

r = await req('GET', `/payments/${pay.id}`, { token });
check('cobrança APPROVED', r.json?.data?.status === 'APPROVED' && !!r.json?.data?.paidAt);
r = await req('GET', `/me/orders/${order.id}`, { token });
check('pedido PAID + CONFIRMED', r.json?.data?.order?.paymentStatus === 'PAID' && r.json?.data?.order?.status === 'CONFIRMED', JSON.stringify({ s: r.json?.data?.order?.status, ps: r.json?.data?.order?.paymentStatus }));

// --- 8. Pedido pago não gera nova cobrança ---
r = await req('POST', `/orders/${order.id}/payments`, { token });
check('pedido pago → 409', r.status === 409, `status=${r.status}`);

// --- 9. Simulação de cancelamento (2º pedido) ---
r = await req('POST', '/cart/items', { token, body: { productId: prod.id, quantity: 1 } });
r = await req('POST', '/orders', {
  token,
  body: { customerName: 'Smoke R19', customerEmail: email, customerPhone: '54999990000', address: addr, shippingValue: 20, paymentMethod: 'PIX' },
});
const order2 = r.json?.data?.order;
r = await req('POST', `/orders/${order2.id}/payments`, { token });
const pay2 = r.json?.data;
r = await req('POST', `/payments/${pay2.id}/simulate`, { token, body: { status: 'canceled' } });
check('simulate canceled aplicado', r.status === 200 && r.json?.data?.applied === true && r.json?.data?.payment?.status === 'CANCELED', JSON.stringify(r.json));
r = await req('POST', `/payments/${pay2.id}/simulate`, { token, body: { status: 'approved' } });
check('aprovar cobrança cancelada é no-op', r.status === 200 && r.json?.data?.applied === false);
r = await req('GET', `/me/orders/${order2.id}`, { token });
check('pedido 2 segue PENDING (cancelamento não paga)', r.json?.data?.order?.paymentStatus === 'PENDING');

// --- 10. Nova cobrança após cancelada + simulate expired ---
r = await req('POST', `/orders/${order2.id}/payments`, { token });
check('pedido com cobrança cancelada gera NOVA cobrança (201)', r.status === 201 && r.json?.data?.id !== pay2.id);
const pay3 = r.json?.data;
r = await req('POST', `/payments/${pay3.id}/simulate`, { token, body: { status: 'expired' } });
check('simulate expired aplicado', r.json?.data?.payment?.status === 'EXPIRED');

// --- 11. Controle de acesso ---
const email2 = `smoke.r19.b.${Date.now()}@teste.com`;
r = await req('POST', '/auth/register', { body: { name: 'Outro', email: email2, password: 'senha12345' } });
const token2 = r.json?.data?.token;
r = await req('GET', `/payments/${pay.id}`, { token: token2 });
check('cobrança de outro cliente → 404', r.status === 404, `status=${r.status}`);
r = await req('POST', `/payments/${pay.id}/simulate`, { token: token2, body: { status: 'approved' } });
check('simulate de outro cliente → 404', r.status === 404, `status=${r.status}`);
r = await req('GET', `/payments/${pay.id}`);
check('sem token → 401', r.status === 401);

// --- 12. Admin vê trilha de eventos ---
r = await req('POST', '/auth/login', { body: { email: 'admin@3dcommerce.com', password: 'admin123' } });
const adminToken = r.json?.data?.token;
r = await req('GET', `/admin/payments/${pay.id}`, { token: adminToken });
const events = r.json?.data?.events ?? [];
check('admin: trilha de eventos registrada', events.length >= 2 && events.some((e) => e.type === 'pix.created') && events.some((e) => e.type === 'pix.approved'), JSON.stringify(events.map((e) => e.type)));

console.log(`\nResultado: ${passed} OK, ${failed} FALHOU`);
process.exit(failed ? 1 : 0);
