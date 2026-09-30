# Mercado Pago — Orders API (`/v1/orders`) — Notas de Referência

Spike T9 · projeto 3D-Commerce · React/Vite (front) + Express/Prisma (back) · ambiente: **sandbox**.
Modelo: **Checkout Transparente via Orders API** + **Payment Brick** no front. Métodos: cartão, Pix, boleto.

> **Por que migrar:** a MP marcou a Payments API (`/v1/payments`) como "será descontinuada em breve" e recomenda a **Orders API** (`/v1/orders`) para novas integrações de Checkout Transparente. A Payments API antiga está em `payments-notes.md` (T1) — **não substituída ainda**, só referência.
>
> Fontes oficiais no fim. **SDK/doc mudam rápido — reconfira antes de fixar.** Onde a doc está ambígua, marquei com [DUVIDA].

---

## 0. Pacotes já instalados (confirmado no repo)

| Onde | Pacote | Versão instalada | Order? |
|------|--------|------------------|--------|
| Backend | `mercadopago` | **3.6.1** | SIM — existe `node_modules/mercadopago/dist/clients/order` |
| Frontend | `@mercadopago/sdk-react` | **1.0.7** | Payment Brick, sem mudança (secao 6) |

`.env` (mesmas credenciais da Payments API — secao 7):
```
MP_ACCESS_TOKEN=TEST-xxxx     # backend, credencial de TESTE (nunca vai ao front)
MP_WEBHOOK_SECRET=xxxx        # segredo da assinatura do webhook
VITE_MP_PUBLIC_KEY=TEST-xxxx  # frontend
```

---

## 1. Criar uma Order — `POST /v1/orders` (`type: "online"`)

**Endpoint:** `https://api.mercadopago.com/v1/orders`
**Headers obrigatórios:**
- `Authorization: Bearer <MP_ACCESS_TOKEN>`
- `Content-Type: application/json`
- `X-Idempotency-Key: <uuid único por tentativa>` — retry seguro sem cobrar 2x (1–128 chars).

**Campos-tronco do body:**
- `type`: `"online"` (fixo p/ pagamento online no site)
- `total_amount`: **string** — ex. `"50.00"` (atenção: string, não número)
- `external_reference`: **string** (máx 64) — vamos usar o **id do pedido**
- `processing_mode`: `"automatic"` (default) ou `"manual"` (autoriza e captura depois — só cartão)
- `capture_mode`: `"automatic"` | `"manual"` ([DUVIDA] captura diferida de cartão; secao 1.4)
- `payer`: dados do comprador (mínimo `email`; boleto exige mais — secao 1.3)
- `transactions.payments[]`: um item por pagamento, cada um com `amount` + `payment_method`

### 1.1 Cartão de crédito
`token`, `installments` e `payment_method_id` vêm do **Payment Brick** (`formData`, secao 6).
```json
{
  "type": "online",
  "processing_mode": "automatic",
  "external_reference": "PEDIDO_1234",
  "total_amount": "50.00",
  "payer": { "email": "test_user_br@testuser.com" },
  "transactions": {
    "payments": [
      {
        "amount": "50.00",
        "payment_method": {
          "id": "master",
          "type": "credit_card",
          "token": "<formData.token do Brick>",
          "installments": 12
        }
      }
    ]
  }
}
```
- `payment_method.id` = `formData.payment_method_id` (ex. `"master"`, `"visa"`).
- [DUVIDA] `issuer_id` do Brick: a doc de cartão da Orders API não deixa claro onde encaixá-lo no body (não aparece nos exemplos). Se a criação falhar por issuer, testar `payment_method.issuer_id`. **Confirmar em teste** — campo não inventado.

### 1.2 Pix
```json
{
  "type": "online",
  "processing_mode": "automatic",
  "external_reference": "PEDIDO_1234",
  "total_amount": "50.00",
  "payer": { "email": "test_user_br@testuser.com" },
  "transactions": {
    "payments": [
      {
        "amount": "50.00",
        "payment_method": { "id": "pix", "type": "bank_transfer" },
        "expiration_time": "P3Y6M4DT12H30M5S"
      }
    ]
  }
}
```
- `expiration_time`: duração ISO-8601 (ex. `"P1D"` = 1 dia). QR/copia-e-cola voltam na resposta (secao 2.2).

### 1.3 Boleto — payer exige nome + CPF + endereço
```json
{
  "type": "online",
  "processing_mode": "automatic",
  "external_reference": "PEDIDO_1234",
  "total_amount": "50.00",
  "description": "Pedido 3D-Commerce 1234",
  "payer": {
    "email": "test_user_br@testuser.com",
    "first_name": "John",
    "last_name": "Doe",
    "identification": { "type": "CPF", "number": "99999999999" },
    "address": {
      "street_name": "Av. das Nacoes Unidas", "street_number": "3003",
      "zip_code": "06233903", "neighborhood": "Bonfim",
      "state": "SP", "city": "Osasco"
    }
  },
  "transactions": {
    "payments": [
      { "amount": "50.00", "payment_method": { "id": "boleto", "type": "ticket" } }
    ]
  }
}
```
- `expiration_time` opcional (ISO-8601, ex. `"P3D"`).
- [DUVIDA] `payment_method.id`: a doc BR da Orders usa `"boleto"`. Na Payments API antiga o id era `"bolbradesco"`. Se `"boleto"` for rejeitado, testar `"bolbradesco"`. **Confirmar em sandbox.**

### 1.4 Captura diferida (cartão)
`processing_mode: "manual"` + `capture_mode: "manual"` autoriza sem capturar; captura depois via endpoint de capture da Order. Não é o fluxo do MVP — só anotado.

---

## 2. Resposta da Order

### 2.1 Cartão aprovado (automatic)
```json
{
  "id": "01JC1KVZ0WJY8Y4WA7MZAD5S2T",
  "status": "processed",
  "status_detail": "accredited",
  "total_amount": "50.00",
  "external_reference": "PEDIDO_1234",
  "transactions": {
    "payments": [
      { "id": "pay_01JC1KVZ...", "status": "processed", "status_detail": "accredited" }
    ]
  }
}
```
- **id da Order** = string ULID (ex. `01JC...` / `ORD01...`). É o `{id}` do GET (secao 3) e o `data.id` do webhook (secao 4).
- **id do payment** = `transactions.payments[0].id`.

### 2.2 Pix / Boleto — onde vêm os dados de exibição
Status inicial: **`status: "action_required"`** (Order) e no payment:
- Pix -> `status_detail: "waiting_transfer"`
- Boleto -> `status_detail: "waiting_payment"`

Dados ficam em **`transactions.payments[0].payment_method.*`**:

| Método | Campo | Conteúdo |
|--------|-------|----------|
| Pix | `qr_code` | copia-e-cola (texto do QR) |
| Pix | `qr_code_base64` | PNG do QR em base64 (renderizar `<img>`) |
| Pix | `ticket_url` | página MP com QR + copia-e-cola + instruções |
| Boleto | `ticket_url` | link do boleto p/ o comprador |
| Boleto | `barcode_content` | código de barras (EAN-13) |
| Boleto | `digitable_line` | linha digitável |

### 2.3 Mapa de status (Order e payment)
**Order.status:** `processed` (concluído) · `pending` · `action_required` (aguardando ação externa: Pix/boleto/3DS) · `refunded` · `cancelled` · `failed`.
**payment.status** (em `transactions.payments[]`): `processed`/`approved`, `pending`, `rejected`, `cancelled`, `refunded`.
[DUVIDA] A doc mistura vocabulário Order (`processed`/`action_required`) e payment (`approved`/`rejected`) e não publica uma tabela única exaustiva. Regra de negócio: **liberar pedido só com Order `processed` + payment aprovado**; `action_required` = mostrar QR/boleto e esperar webhook. Confirmar os valores fechados por método em sandbox.

---

## 3. Consultar Order (reconciliação) — `GET /v1/orders/{id}`

```
GET https://api.mercadopago.com/v1/orders/01JC1KVZ0WJY8Y4WA7MZAD5S2T
Authorization: Bearer <MP_ACCESS_TOKEN>
```
Retorna a mesma estrutura da secao 2 (status + transactions.payments[]). Usar no handler de webhook e num job de reconciliação (Pix/boleto pagos fora do fluxo síncrono). Fonte da verdade = sempre reconsultar, nunca confiar só no corpo do webhook.

---

## 4. Webhook / notificações (Orders API)

**Topic/type:** chega **`type=order`** (não mais `payment`). Ex. `action: "order.processed"`.
Configurar em *Suas integrações > Webhooks* e assinar o evento **Orders**.

**Query params** na URL: `?data.id=ORD01M28P44...&type=order`

**Corpo (POST):**
```json
{
  "action": "order.processed",
  "api_version": "v1",
  "application_id": "...",
  "type": "order",
  "live_mode": true,
  "data": {
    "id": "ORD01M28P44G5FG8RJPM579EH56FV",
    "status": "processed",
    "status_detail": "accredited",
    "total_amount": "200.00",
    "transactions": { "payments": [] }
  }
}
```
> [IMPORTANTE] O `data.id` do webhook é o **id da Order** — reconciliar em `GET /v1/orders/{id}` (secao 3), não `/v1/payments/{id}`. Diferença prática vs. Payments API (lá vinha `type=payment` e consultava-se `/v1/payments/{id}`).

**Validar `x-signature` — MESMA mecânica HMAC-SHA256 da Payments API.**
Header: `x-signature: ts=1742505638683,v1=<hmac_hex>` + header `x-request-id`.
Manifest (template oficial):
```
id:[data.id_url];request-id:[x-request-id_header];ts:[ts_header];
```
- `data.id` em **minúsculas**; omita partes ausentes; **termina em `;`**.
- `hmac_sha256(manifest, MP_WEBHOOK_SECRET)` em hex -> comparar com `v1`.
- Responder **200/201 em até 22s**, senão a MP re-tenta.

Pseudo (Node):
```js
import crypto from 'crypto';
const [tsPart, v1Part] = req.headers['x-signature'].split(',');
const ts = tsPart.split('=')[1];
const v1 = v1Part.split('=')[1];
const manifest = `id:${String(req.query['data.id']).toLowerCase()};request-id:${req.headers['x-request-id']};ts:${ts};`;
const hmac = crypto.createHmac('sha256', process.env.MP_WEBHOOK_SECRET).update(manifest).digest('hex');
if (hmac !== v1) return res.sendStatus(401);
// então: GET /v1/orders/{data.id} para status confiável e atualizar o pedido
```
**Fluxo recomendado:** validar assinatura -> responder 200 rápido -> GET `/v1/orders/{id}` -> aplicar status ao pedido (idempotente por order id / external_reference).

---

## 5. SDK Node `mercadopago` v3 (3.6.1) — resource `Order`

**SIM, há resource `Order`.** A versão instalada (3.6.1) tem `dist/clients/order` e a doc/README oficiais mostram:
```js
import { MercadoPagoConfig, Order } from 'mercadopago';

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 5000 },
});

const order = new Order(client);

const result = await order.create({
  body: { /* body da secao 1 */ },
  requestOptions: { idempotencyKey: crypto.randomUUID() }, // X-Idempotency-Key
});
```
- Consulta: `order.get({ id })` ([DUVIDA] nome exato a confirmar — família create/get/process/capture/cancel/refund).
- [DUVIDA] **Ressalva de tipos:** não consegui reler o `.d.ts` do client `order` (arquivos em OneDrive, hidratação intermitente). O client existe, mas os tipos TS da Orders API são recentes e podem não cobrir 100% o body `online`. Se o TS reclamar ou faltar método, cair para **fetch direto** (funcionalmente idêntico).

**Fallback fetch direto (sempre funciona):**
```js
const r = await fetch('https://api.mercadopago.com/v1/orders', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    'X-Idempotency-Key': crypto.randomUUID(),
  },
  body: JSON.stringify(orderBody),
});
const order = await r.json();
```
O **token do cartão** continua sendo gerado no front pelo Brick — o backend nunca vê o número do cartão.

---

## 6. Frontend `@mercadopago/sdk-react` (Payment Brick, 1.0.7)

**O Brick NÃO muda entre Payments API e Orders API.** Ele tokeniza o cartão e coleta os dados do pagador do mesmo jeito; a diferença é 100% no **backend** (monta Order em vez de Payment).

`onSubmit` devolve **o mesmo** `{ selectedPaymentMethod, formData }`:
```js
onSubmit={async ({ selectedPaymentMethod, formData }) => {
  // formData: { token, issuer_id, payment_method_id, transaction_amount, installments,
  //             payer: { email, identification: { type, number } } }
  await fetch('/api/orders', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ ...formData, selectedPaymentMethod, pedidoId }) });
}}
```
**O que o backend extrai do `formData` para montar a Order:**
| formData | vai para (body Order) |
|----------|-----------------------|
| `token` | `transactions.payments[0].payment_method.token` (cartão) |
| `payment_method_id` | `transactions.payments[0].payment_method.id` |
| `installments` | `transactions.payments[0].payment_method.installments` |
| `transaction_amount` | `total_amount` e `amount` (converter para **string**) |
| `payer.email` | `payer.email` |
| `payer.identification` | `payer.identification` (boleto) |
| `issuer_id` | [DUVIDA] secao 1.1 (posição no body a confirmar) |
| `selectedPaymentMethod` | escolhe o preset: `credit_card` / `bank_transfer`(pix) / `ticket`(boleto) |

Para Pix/boleto o `formData` traz menos campos (sem token); o back monta o `payment_method` do método.

---

## 7. Sandbox — o que muda vs. Payments API

**Quase nada.** Credenciais e usuários de teste são os mesmos da conta/aplicação:
- **Mesmas credenciais de TESTE** (`TEST-...` access token + public key). A Orders API roda em sandbox com a mesma app.
- **Mesmos cartões de teste + nome do titular p/ forçar status** (não muda): CVV `123` (Amex `1234`), validade `11/30`, CPF de teste `12345678909`.
  - Titular **APRO** = aprovado · **OTHE** = recusado (erro geral) · **CONT** = pendente · **FUND** = saldo insuficiente · **SECU** = CVV inválido · **EXPI** = expirado · **FORM** = erro de formulário.
  - Números (validar no painel BR — variam por país): Master `5474 9254 3267 0366`, Visa `4075 5957 1648 3764`, Amex `3711 803032 57522`.
- **Pix/boleto em sandbox:** criar **usuário de teste** (comprador BR) para simular; o pagamento não é real. Pix de teste é aprovado via simulador do usuário de teste.
- [GOTCHA] `total_amount`/`amount` são **string** — mandar número quebra. E o webhook agora manda `type=order` (reconfigurar a assinatura para o evento **Orders**, não Payments).

---

## Fontes (verificar — docs mudam)
- Orders API overview: https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/overview
- Modelo de integração: https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/integration-model
- Create order (API ref): https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/create-order/post
- Pix (Orders): https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-integration/pix
- Boleto (Orders): https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-integration/boleto
- Notificacoes/Webhooks (Orders): https://www.mercadopago.com.mx/developers/en/docs/checkout-api-orders/notifications
- SDK Node oficial: https://github.com/mercadopago/sdk-nodejs
- Payment Brick (front): https://www.mercadopago.com.br/developers/en/docs/checkout-bricks/payment-brick/default-rendering
- Cartoes de teste: https://www.mercadopago.com.mx/developers/en/docs/checkout-bricks/additional-content/your-integrations/test/cards
