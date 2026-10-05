# Mercado Pago — Checkout Transparente (Payment Bricks) — Notas de Referência

Spike T1 · projeto 3D-Commerce · React/Vite (front) + Express/Prisma (back) · ambiente inicial: sandbox.
Métodos: cartão de crédito, Pix e boleto — tudo pago dentro do site.

> Fontes oficiais no final. SDKs mudam de versão rápido — confira `npm view <pkg> version` antes de fixar.

## 0. Pacotes e versões

| Onde | Pacote | Versão | Obs |
|------|--------|--------|-----|
| Backend | `mercadopago` | v2.x (v1 depreciada) | Node >= 18 |
| Frontend | `@mercadopago/sdk-react` | v1.x (usa `@mercadopago/sdk-js` por baixo) | React 18 |

```bash
npm install --save mercadopago            # backend
npm install @mercadopago/sdk-react        # frontend
```

`.env`:
```
MP_ACCESS_TOKEN=TEST-xxxx     # backend, credencial de TESTE
MP_WEBHOOK_SECRET=xxxx        # backend, segredo da assinatura do webhook
VITE_MP_PUBLIC_KEY=TEST-xxxx  # frontend, chave publica de TESTE
```
O ACCESS_TOKEN nunca vai ao front. Só a PUBLIC_KEY.

## 1. Backend — criar pagamentos (`Payment`, SDK v2)

```js
import { MercadoPagoConfig, Payment } from 'mercadopago';

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 5000 },
});
const payment = new Payment(client);
```

Regra de ouro: `payment.create({ body, requestOptions })`. O X-Idempotency-Key vai em
`requestOptions.idempotencyKey` — chave estável por tentativa (ex.: `order:{id}:card`) para que um
retry não gere pagamento duplicado.

### 1a. Cartão de crédito (recebe o `token` do Brick; nunca o número do cartão)
```js
const result = await payment.create({
  body: {
    transaction_amount: 199.90,
    token,                              // do formData do Brick
    description: 'Pedido #1234',
    installments,                       // ex.: 3
    payment_method_id,                  // ex.: 'master', 'visa'
    issuer_id,                          // do Brick
    external_reference: String(orderId),
    payer: { email: payerEmail },
  },
  requestOptions: { idempotencyKey: `order:${orderId}:card` },
});
// result.status: 'approved' | 'in_process' | 'rejected'
// result.status_detail: 'accredited' | 'cc_rejected_...'
```

### 1b. Pix
```js
const result = await payment.create({
  body: {
    transaction_amount: 199.90,
    description: 'Pedido #1234',
    payment_method_id: 'pix',
    external_reference: String(orderId),
    payer: { email: payerEmail, first_name: 'Joao', last_name: 'Silva',
             identification: { type: 'CPF', number: '12345678909' } },
  },
  requestOptions: { idempotencyKey: `order:${orderId}:pix` },
});
// status 'pending' ate cair. QR em:
const poi = result.point_of_interaction.transaction_data;
poi.qr_code;         // copia-e-cola
poi.qr_code_base64;  // <img src={`data:image/png;base64,${poi.qr_code_base64}`}/>
poi.ticket_url;      // pagina do QR hospedada pela MP
```

### 1c. Boleto
```js
const result = await payment.create({
  body: {
    transaction_amount: 199.90,
    description: 'Pedido #1234',
    payment_method_id: 'bolbradesco',
    external_reference: String(orderId),
    // date_of_expiration: '2026-09-20T23:59:59.000-03:00', // >= 3 dias
    payer: { email: payerEmail, first_name: 'Joao', last_name: 'Silva',
             identification: { type: 'CPF', number: '12345678909' },
             address: { zip_code: '06233200', street_name: 'Av. das Nacoes Unidas',
                        street_number: '3003', neighborhood: 'Bonfim',
                        city: 'Osasco', federal_unit: 'SP' } },
  },
  requestOptions: { idempotencyKey: `order:${orderId}:boleto` },
});
// status 'pending' / status_detail 'pending_waiting_payment'
result.transaction_details.external_resource_url; // link/PDF do boleto
```

> Pix e boleto exigem `payer.identification` (CPF/CNPJ). Cartão não. `external_reference` = id do
> pedido, sempre — é o gancho de reconciliacao no webhook.

## 2. Frontend — Payment Brick (`@mercadopago/sdk-react`)

Um único Brick cobre cartão + Pix + boleto conforme `customization.paymentMethods`.

```jsx
import { initMercadoPago, Payment } from '@mercadopago/sdk-react';

initMercadoPago(import.meta.env.VITE_MP_PUBLIC_KEY, { locale: 'pt-BR' });

export default function Checkout({ orderId, amount }) {
  const initialization = {
    amount,                 // total do pedido (obrigatorio)
    // preferenceId: '...', // opcional; nao e preciso p/ checkout transparente
    payer: { email: '' },
  };

  const customization = {
    paymentMethods: {
      creditCard: 'all',    // cartao de credito
      bankTransfer: 'all',  // Pix
      ticket: 'all',        // boleto
      // debitCard: 'all',
    },
  };

  // onSubmit -> { selectedPaymentMethod, formData }.
  // formData ja vem no shape de payment.create (token, installments, payment_method_id,
  // issuer_id, payer...). Cartao inclui `token`; Pix/boleto nao.
  const onSubmit = async ({ selectedPaymentMethod, formData }) => {
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, selectedPaymentMethod, formData }),
    });
    if (!res.ok) throw new Error('pagamento falhou');
    // resolver a Promise faz o Brick exibir a tela de sucesso / QR / boleto
  };

  const onError = async (error) => console.error(error);
  const onReady = async () => {};

  return (
    <Payment
      initialization={initialization}
      customization={customization}
      onSubmit={onSubmit}
      onReady={onReady}
      onError={onError}
    />
  );
}
```

No backend, ramifique por `selectedPaymentMethod` (ou `formData.payment_type_id`) e monte o `body`
da secao 1 a partir do `formData` — repasse token/installments/payment_method_id/issuer_id/payer e
some `external_reference` + `idempotencyKey`.

## 3. Webhook / notificações

Configure em Suas integracoes -> Webhooks, evento Pagamentos. A MP faz POST na sua URL.

Payload:
```json
{ "id": 12345, "live_mode": false, "type": "payment",
  "action": "payment.created", "data": { "id": "999999999" } }
```

Fluxo recomendado: recebe id -> consulta o pagamento na API -> atualiza status no banco. Nunca
confie no corpo do webhook como verdade; ele só diz "ha novidade nesse id".

### Validar a assinatura (x-signature)
Headers: `x-signature` (formato `ts=...,v1=...`) e `x-request-id`. O `data.id` vem da query string
(`?data.id=...`).

```js
import crypto from 'crypto';

function validarAssinatura(req) {
  const xSignature = req.headers['x-signature'];   // "ts=...,v1=..."
  const xRequestId = req.headers['x-request-id'];
  const dataId = req.query['data.id'];             // da query string

  const parts = Object.fromEntries(
    xSignature.split(',').map(kv => kv.split('=').map(s => s.trim()))
  );
  const { ts, v1 } = parts;

  // template oficial; data.id em minusculas se for alfanumerico
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId};ts:${ts};`;

  const hmac = crypto.createHmac('sha256', process.env.MP_WEBHOOK_SECRET)
                     .update(manifest).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(v1));
}
```
Se algum campo do template nao existir na notificacao, remova-o do manifest antes do HMAC.

### Handler + idempotência
```js
app.post('/api/webhooks/mp', async (req, res) => {
  if (!validarAssinatura(req)) return res.sendStatus(401);
  res.sendStatus(200);                 // responda rapido (< ~22s) p/ evitar retry

  if (req.body.type !== 'payment') return;
  const pago = await payment.get({ id: req.body.data.id });  // fonte de verdade
  // idempotencia: payment.id (ou external_reference) como chave unica; so aplique a
  // transicao se ainda nao processada. A MP reenvia se nao receber 2xx.
  await atualizarPedido(pago.external_reference, pago.status, pago.id);
});
```

## 4. Sandbox — passo a passo

1. Credenciais de teste: Devsite -> Suas integracoes -> sua aplicacao -> Credenciais de teste.
   Public Key e Access Token com prefixo `TEST-`.
2. Contas de teste (vendedor e comprador): na aplicacao -> Contas de teste -> "+ Criar conta de
   teste". Crie uma vendedora e uma compradora (login/senha proprios do sandbox).
3. Cartões de teste — o resultado é decidido pelo NOME DO TITULAR, não pelo número:

   | Bandeira | Numero | CVV | Validade |
   |----------|--------|-----|----------|
   | Mastercard | 5031 4332 1540 6351 | 123 | 11/30 |
   | Visa | 4235 6477 2802 5682 | 123 | 11/30 |
   | Amex | 3753 651535 56885 | 1234 | 11/30 |

   Nome do titular = cenario: `APRO` aprova · `OTHE` recusa (erro geral) · `CONT` pendente ·
   `FUND` sem saldo · `SECU` CVV invalido · `EXPI` validade · `CALL` recusa c/ autorizacao ·
   `FORM` erro de formulario. CPF de teste: `12345678909`.
4. Pix / boleto em sandbox: crie o pagamento com credencial `TEST-`; Pix retorna QR/copia-e-cola,
   boleto retorna `external_resource_url` — sem cobranca real. Confirme via Simulador de
   notificacoes (painel Webhooks) ou pague pela conta de teste compradora.
5. Webhook em dev (URL publica): a MP precisa alcancar sua maquina. Suba um tunel
   (`ngrok http 3000` ou similar), cadastre `https://<tunel>/api/webhooks/mp` em Webhooks, gere/copie
   o segredo da assinatura e ponha em `MP_WEBHOOK_SECRET`. Teste com o Simulador de notificacoes.

## Fontes (verificar — docs mudam)
- SDK Node: https://github.com/mercadopago/sdk-nodejs · https://www.npmjs.com/package/mercadopago
- SDK React: https://github.com/mercadopago/sdk-react · https://www.npmjs.com/package/@mercadopago/sdk-react
- Payment Brick: https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/payment-brick/default-rendering
- Pix/boleto backend: https://www.mercadopago.com.br/developers/en/docs/checkout-bricks/payment-brick/payment-submission/other-payment-methods
- Webhooks + x-signature: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
- Cartoes de teste: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/test/cards
- Contas de teste: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/test/accounts
