/**
 * SCRIPT TEMPORÁRIO (T13) — valida a correção do boleto na Orders API.
 * Controle: mesmo body, address com `federal_unit` (esperado 400) vs `state`
 * (esperado 201 + ticket_url). Roda contra o SANDBOX (.env do backend).
 * Não move dinheiro; boleto de teste só gera linha/ticket.
 */
import 'dotenv/config';
import crypto from 'node:crypto';

const ACCESS = process.env.MP_ACCESS_TOKEN;
const BASE = 'https://api.mercadopago.com';
if (!ACCESS) { console.error('Falta MP_ACCESS_TOKEN no .env'); process.exit(1); }

const email = 'test_user_apro@testuser.com';
const baseAddr = {
  street_name: 'Av. das Nacoes Unidas', street_number: '3003',
  zip_code: '06233903', neighborhood: 'Bonfim', city: 'Osasco',
};
const bodyWith = (addr) => ({
  type: 'online', processing_mode: 'automatic', total_amount: '10.00',
  external_reference: `T13-BOL-${Date.now()}`, description: 'T13 boleto check',
  payer: {
    email, first_name: 'Test', last_name: 'User',
    identification: { type: 'CPF', number: '12345678909' },
    address: addr,
  },
  transactions: { payments: [{ amount: '10.00', payment_method: { id: 'bolbradesco', type: 'ticket' } }] },
});

async function run(label, addr) {
  const res = await fetch(`${BASE}/v1/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(bodyWith(addr)),
  });
  const j = await res.json().catch(() => ({}));
  const order = res.ok ? j : (j?.data ?? {});
  const p = order?.transactions?.payments?.[0] ?? {};
  console.log(`\n== ${label} :: HTTP ${res.status} ==`);
  console.log('order.status =', order.status, '| payment.status =', p.status, '/', p.status_detail);
  console.log('ticket_url present =', !!p.payment_method?.ticket_url);
  if (!res.ok) console.log('ERRO first =', JSON.stringify(j?.errors?.[0] ?? j));
}

await run('CONTROLE: federal_unit (bug antigo)', { ...baseAddr, federal_unit: 'SP' });
await run('FIX: state (o que o service manda agora)', { ...baseAddr, state: 'SP' });
