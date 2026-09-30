/** SCRIPT MANUAL / TEMPORÁRIO — diagnóstico fino do 422 (T10). */
import 'dotenv/config';
import crypto from 'node:crypto';

const ACCESS = process.env.MP_ACCESS_TOKEN;
const PUBLIC = process.env.MP_PUBLIC_KEY;
const BASE = 'https://api.mercadopago.com';
const auth = () => ({ Authorization: `Bearer ${ACCESS}`, 'Content-Type': 'application/json' });

async function post(path, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { ...auth(), ...extraHeaders }, body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, reqId: res.headers.get('x-request-id') };
}

async function order(label, body) {
  const r = await post('/v1/orders', body, { 'X-Idempotency-Key': crypto.randomUUID() });
  console.log(`\n===== ${label} :: HTTP ${r.status} (x-request-id ${r.reqId}) =====`);
  console.log(r.text);
  try { return JSON.parse(r.text); } catch { return {}; }
}

async function tokenize(cardNumber, name) {
  const res = await fetch(`${BASE}/v1/card_tokens?public_key=${encodeURIComponent(PUBLIC)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      card_number: cardNumber, expiration_month: 11, expiration_year: 2030, security_code: '123',
      cardholder: { name, identification: { type: 'CPF', number: '12345678909' } },
    }),
  });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, id: j.id, first_six: j.first_six_digits, raw: j };
}

async function issuerFor(bin, pmId) {
  const res = await fetch(`${BASE}/v1/payment_methods/card_issuers?payment_method_id=${pmId}&bin=${bin}`, { headers: auth() });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, issuers: j };
}

async function main() {
  const email = 'test_user_apro@testuser.com';

  // --- CARTÃO: guia usa Master 5474 9254 3267 0366 ---
  const tk = await tokenize('5474925432670366', 'APRO');
  console.log('tokenize card status', tk.status, '| token?', !!tk.id, '| first_six', tk.first_six);
  if (tk.id) {
    const iss = await issuerFor(tk.first_six, 'master');
    console.log('card_issuers status', iss.status, '| issuers=', JSON.stringify(iss.issuers));
    const issuerId = Array.isArray(iss.issuers) && iss.issuers[0]?.id;

    // A) sem issuer_id, amount 10.00
    await order('CARD A (no issuer, 10.00)', {
      type: 'online', processing_mode: 'automatic',
      external_reference: `D-CARDA-${Date.now()}`, total_amount: '10.00',
      payer: { email },
      transactions: { payments: [{ amount: '10.00', payment_method: { id: 'master', type: 'credit_card', token: tk.id, installments: 1 } }] },
    });

    // B) com issuer_id em payment_method
    const tk2 = await tokenize('5474925432670366', 'APRO');
    if (tk2.id && issuerId) {
      await order('CARD B (issuer_id in payment_method)', {
        type: 'online', processing_mode: 'automatic',
        external_reference: `D-CARDB-${Date.now()}`, total_amount: '10.00',
        payer: { email },
        transactions: { payments: [{ amount: '10.00', payment_method: { id: 'master', type: 'credit_card', token: tk2.id, installments: 1, issuer_id: String(issuerId) } }] },
      });
    }
  }

  // --- BOLETO: amount maior (test min) ---
  const boletoPayer = {
    email, first_name: 'Test', last_name: 'User',
    identification: { type: 'CPF', number: '12345678909' },
    address: { street_name: 'Av. das Nacoes Unidas', street_number: '3003', zip_code: '06233903', neighborhood: 'Bonfim', state: 'SP', city: 'Osasco' },
  };
  for (const [id, amt] of [['bolbradesco', '10.00'], ['boleto', '10.00']]) {
    await order(`BOLETO id=${id} amt=${amt}`, {
      type: 'online', processing_mode: 'automatic',
      external_reference: `D-BOL-${id}-${Date.now()}`, total_amount: amt, description: 'Sandbox boleto',
      payer: boletoPayer,
      transactions: { payments: [{ amount: amt, payment_method: { id, type: 'ticket' } }] },
    });
  }
}
main().catch((e) => { console.error('fatal', e); process.exit(1); });
