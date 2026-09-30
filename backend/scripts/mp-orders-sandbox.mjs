/**
 * SCRIPT MANUAL / TEMPORÁRIO — validação da Orders API do Mercado Pago (T10).
 *
 * NÃO faz parte do runtime (fica fora de src/, ignorado pelo tsc). Roda uma vez
 * contra o SANDBOX (credenciais de TESTE do .env) para reproduzir as respostas
 * reais que embasaram a migração em payments.service.ts.
 *
 * Uso:  cd backend && node scripts/mp-orders-sandbox.mjs
 *
 * Segurança: usa cartões de TESTE e valores mínimos. Pix/boleto só geram
 * QR/linha e não movem dinheiro; cartão de teste recusado (402) também não
 * cobra. Nunca imprime o access token nem número de cartão.
 *
 * ------------------------------------------------------------------------
 * O QUE O SANDBOX REVELOU (as 4 dúvidas do orders-api-notes.md), observado:
 *
 *  Conta: /users/me → tags inclui "test_user" (é conta de teste). site MLB.
 *
 *  (1) issuer_id do cartão: NÃO vai no body. Enviar em payment_method dá
 *      HTTP 400 "additionalProperties 'issuer_id' not allowed". O cartão é
 *      aprovado SEM issuer_id (o MP infere pelo token). → não enviar.
 *
 *  (2) id do boleto: "boleto" E "bolbradesco" são aceitos (ambos 201). O 422
 *      inicial era pelo valor baixo (1.00), não pelo id — boleto tem mínimo.
 *
 *  (3) status reais (payment em transactions.payments[0]):
 *        cartão aprovado (APRO) → HTTP 201, status "processed"  / detail "accredited"
 *        cartão recusado (OTHE) → HTTP 402, status "failed"     / detail "rejected_by_issuer"
 *        cartão saldo (FUND)    → HTTP 402, status "failed"     / detail "insufficient_amount"
 *        cartão pendente (CONT) → HTTP 201, status "processing" / detail "in_process"
 *        Pix (sem pagar)        → HTTP 201, status "action_required" / detail "waiting_transfer"
 *        boleto (sem pagar)     → HTTP 201, status "action_required" / detail "waiting_payment"
 *      IMPORTANTE: recusa de cartão vem como HTTP 402 com o pedido em body.data
 *      (por isso o service usa fetch direto, não o SDK, que lançaria).
 *      Pix: payment_method traz qr_code, qr_code_base64, ticket_url.
 *      Boleto: payment_method traz ticket_url, digitable_line, barcode_content.
 *
 *  (4) SDK: `new Order(client).create({body, requestOptions:{idempotencyKey}})`
 *      e `order.get({ id })` existem e funcionam (get confirmado no sandbox).
 *      Ainda assim o service usa fetch direto por causa do 402 (dúvida 3).
 * ------------------------------------------------------------------------
 */
import 'dotenv/config';
import crypto from 'node:crypto';

const ACCESS = process.env.MP_ACCESS_TOKEN;
const PUBLIC = process.env.MP_PUBLIC_KEY;
const BASE = 'https://api.mercadopago.com';
if (!ACCESS || !PUBLIC) {
  console.error('Faltam MP_ACCESS_TOKEN / MP_PUBLIC_KEY no .env');
  process.exit(1);
}
const auth = () => ({ Authorization: `Bearer ${ACCESS}`, 'Content-Type': 'application/json' });

async function createOrder(label, body) {
  const res = await fetch(`${BASE}/v1/orders`, {
    method: 'POST',
    headers: { ...auth(), 'X-Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  const order = res.ok ? json : json?.data ?? {};
  const p = order?.transactions?.payments?.[0] ?? {};
  console.log(`\n== ${label} :: HTTP ${res.status} ==`);
  console.log('order.status   =', order.status, '/ detail', order.status_detail, '| order.id', order.id);
  console.log('payment.status =', p.status, '/ detail', p.status_detail);
  if (p.payment_method) {
    const m = p.payment_method;
    console.log('pm =', JSON.stringify({
      id: m.id, type: m.type,
      qr_code: m.qr_code ? '(present)' : undefined,
      qr_code_base64: m.qr_code_base64 ? '(present)' : undefined,
      ticket_url: m.ticket_url, digitable_line: m.digitable_line, barcode_content: m.barcode_content,
    }));
  }
  if (!res.ok && !json?.data) console.log('ERRO:', JSON.stringify(json));
  return order.id;
}

async function tokenizeTestCard(holder) {
  // Master de teste (MLB) — CVV 123, validade 11/30, CPF de teste 12345678909.
  const res = await fetch(`${BASE}/v1/card_tokens?public_key=${encodeURIComponent(PUBLIC)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      card_number: '5474925432670366', expiration_month: 11, expiration_year: 2030, security_code: '123',
      cardholder: { name: holder, identification: { type: 'CPF', number: '12345678909' } },
    }),
  });
  const j = await res.json().catch(() => ({}));
  return j.id ?? null;
}

async function main() {
  const me = await (await fetch(`${BASE}/users/me`, { headers: auth() })).json();
  console.log('== /users/me == tags:', JSON.stringify(me.tags), '| site', me.site_id);

  const email = 'test_user_apro@testuser.com';
  const cardBody = (token, extra = {}) => ({
    type: 'online', processing_mode: 'automatic', total_amount: '10.00',
    external_reference: `SANDBOX-${Date.now()}`, payer: { email },
    transactions: { payments: [{ amount: '10.00', payment_method: { id: 'master', type: 'credit_card', token, installments: 1, ...extra } }] },
  });

  const approTk = await tokenizeTestCard('APRO');
  if (approTk) await createOrder('CARTÃO APRO (aprova)', cardBody(approTk));

  const otheTk = await tokenizeTestCard('OTHE');
  if (otheTk) await createOrder('CARTÃO OTHE (recusa 402)', cardBody(otheTk));

  await createOrder('PIX', {
    type: 'online', processing_mode: 'automatic', total_amount: '10.00',
    external_reference: `SANDBOX-PIX-${Date.now()}`,
    payer: { email, identification: { type: 'CPF', number: '12345678909' } },
    transactions: { payments: [{ amount: '10.00', payment_method: { id: 'pix', type: 'bank_transfer' }, expiration_time: 'P1D' }] },
  });

  const boletoId = await createOrder('BOLETO', {
    type: 'online', processing_mode: 'automatic', total_amount: '10.00',
    external_reference: `SANDBOX-BOL-${Date.now()}`, description: 'Sandbox boleto',
    payer: {
      email, first_name: 'Test', last_name: 'User', identification: { type: 'CPF', number: '12345678909' },
      address: { street_name: 'Av. das Nacoes Unidas', street_number: '3003', zip_code: '06233903', neighborhood: 'Bonfim', state: 'SP', city: 'Osasco' },
    },
    transactions: { payments: [{ amount: '10.00', payment_method: { id: 'bolbradesco', type: 'ticket' } }] },
  });

  // Confirma o método de consulta do SDK.
  if (boletoId) {
    const { MercadoPagoConfig, Order } = await import('mercadopago');
    const order = new Order(new MercadoPagoConfig({ accessToken: ACCESS, options: { timeout: 5000 } }));
    const got = await order.get({ id: boletoId });
    console.log('\n== SDK order.get == id', got.id, '| status', got.status, '/', got.status_detail);
  }
}
main().catch((e) => { console.error('fatal', e); process.exit(1); });
