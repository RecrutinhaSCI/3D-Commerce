# Frete real por CEP/peso — notas do spike F2-FRETE-SPIKE

Objetivo: substituir o frete fixo do checkout por cotacao real por CEP + peso/dimensoes.
Loja: Bento Goncalves/RS, envia pra todo o Brasil.

> Fontes oficiais consultadas em 2026-09-15. Endpoints e campos podem mudar — reconfirmar na doc antes de codar.

---

## Recomendacao: Melhor Envio

Uma unica API cobre Correios + Jadlog + Loggi + outras transportadoras, tem sandbox com R$10.000 de saldo fake, e o cadastro e simples (nao exige contrato proprio com transportadora). Para loja pequena de Bento Goncalves e o caminho de menor atrito: sem contrato Correios, sem 2FA/CWS, e ja compara precos/prazos entre varias transportadoras numa chamada so.

---

## 1. Melhor Envio — API de calculo de frete

**Endpoint (cotacao):** `POST /api/v2/me/shipment/calculate`

**Base URLs:**
- Sandbox: `https://sandbox.melhorenvio.com.br`
- Producao: `https://melhorenvio.com.br`

**Headers obrigatorios:**
```
Authorization: Bearer <TOKEN>
Accept: application/json
Content-Type: application/json
User-Agent: 3D-Commerce (gabriel.flores@ludfor.com.br)
```
> O User-Agent com nome do app + email de contato e exigido; sem ele a API pode recusar.

**Request body (opcao "produtos" — deixa o Melhor Envio empacotar):**
```json
{
  "from": { "postal_code": "95700000" },
  "to":   { "postal_code": "01310100" },
  "products": [
    {
      "id": "prod-cuid",
      "width": 20,
      "height": 15,
      "length": 30,
      "weight": 1.2,
      "insurance_value": 199.90,
      "quantity": 1
    }
  ],
  "options": { "receipt": false, "own_hand": false }
}
```
> width/height/length em cm (inteiro), weight em kg, insurance_value = valor do produto (2 casas).
> length = mapear do campo `depth` do Product.
> Alternativa: enviar `volumes[]` (pacotes ja empacotados) em vez de `products[]`.

**Response (array de servicos/transportadoras):**
```json
[
  {
    "id": 1,
    "name": "PAC",
    "price": "23.50",
    "custom_price": "23.50",
    "delivery_time": 8,
    "custom_delivery_time": 8,
    "company": { "id": 1, "name": "Correios", "picture": "https://..." }
  }
]
```
> Usar `custom_price` e `custom_delivery_time` (ja com as regras/descontos da conta), nao `price`/`delivery_time` crus. Servicos sem cotacao vem com campo `error` — filtrar antes de mostrar.

**Autenticacao:** OAuth2 (token 30 dias, refresh 45 dias) OU token pessoal gerado direto no painel da conta. Para spike/MVP, o token pessoal ja basta para chamar `/calculate` — evita montar o fluxo OAuth completo agora. Para producao multiusuario, migrar pra OAuth com refresh automatico.

---

## 2. Correios direto — o que mudou

- A antiga API publica de preco/prazo (o velho `ws.correios.com.br/calculador/...` sem login) foi descontinuada. Migracao obrigatoria.
- Hoje e o CWS (Correios Web Service) em `https://cws.correios.com.br`, API REST nova (manuais "API Preco" e "API Prazo").
- Exige contrato ativo com os Correios + credenciais do "Meu Correios" + chave de API pedida ao gerente do contrato.
- Duas chaves separadas (Precos/Prazos e Pre-Postagem), validade ~180 dias, revogadas automaticamente depois — precisa reemitir.
- Desde 2026: redefinicao obrigatoria de senha e 2FA nos acessos.

**Vale a pena para loja pequena?** Nao como primeira opcao. O CWS so cobre Correios (nada de Jadlog/Loggi), exige contrato e traz overhead de gestao de chaves que expiram. Faz sentido depois, se o volume crescer e um contrato Correios negociado der frete mais barato — e ai da pra plugar o Correios dentro do proprio Melhor Envio ou direto. Para o spike, ficar no Melhor Envio.

---

## 3. Requisitos de dados — peso/dimensao no Product

Verificado em `backend/prisma/schema.prisma`, model `Product` (linhas 174-178):

```prisma
weight  Decimal? @db.Decimal(10, 3) // kg
width   Decimal? @db.Decimal(10, 2) // cm
height  Decimal? @db.Decimal(10, 2) // cm
depth   Decimal? @db.Decimal(10, 2) // cm
```

**Bom: os 4 campos fisicos ja existem** e nas unidades certas (kg e cm). O `length` que o Melhor Envio pede = o campo `depth` do repo (mapear no adapter).

**O que falta (nao e schema, e dado):**
- Todos sao `Decimal?` (nullable) — produtos existentes podem estar com null. Cotacao quebra ou fica imprecisa sem peso/dimensao.
- Acoes: (a) backfill peso/dimensao nos produtos atuais; (b) tornar os 4 campos obrigatorios no formulario do admin (validacao front + back) para novos produtos; (c) opcional: fallback padrao por categoria pra nao travar o checkout se algum vier null.
- Nenhuma migration de coluna nova e necessaria. Se quiserem forcar no banco (NOT NULL), seria passo separado, so depois do backfill.

---

## 4. Fluxo de integracao recomendado

O backend faz a cotacao (guarda o token, nunca expoe no front). O checkout manda o CEP e recebe a lista de opcoes.

```
[Checkout front]  --CEP destino-->  [Backend /shipping/quote]  --POST /calculate-->  [Melhor Envio]
      ^--- opcoes (nome, preco, prazo) --------------------------------------------------|
```

Passo a passo:
1. Config: guardar `MELHOR_ENVIO_TOKEN` e `MELHOR_ENVIO_BASE_URL` (sandbox/prod) em env do backend. CEP de origem fixo da loja (Bento Goncalves).
2. Endpoint interno novo: `POST /shipping/quote` no backend. Body: `{ cep, items: [{ productId, quantity }] }`.
3. Backend carrega cada produto do banco, monta `products[]` mapeando `depth -> length`, `weight/width/height` direto, `insurance_value = price`, e chama `POST /api/v2/me/shipment/calculate`.
4. Filtrar servicos com `error`, ordenar por `custom_price`, retornar ao front `[{ name, company, price: custom_price, deadline: custom_delivery_time }]`.
5. Checkout front: campo de CEP -> chama `/shipping/quote` -> mostra opcoes (radio) -> soma o frete escolhido ao total.
6. Persistir no pedido o servico/valor de frete escolhido (para depois gerar etiqueta: cart -> checkout -> generate -> tracking, fase posterior).

**Cuidado:** cachear cotacao por (CEP + hash do carrinho) por alguns minutos pra nao estourar rate limit; tratar timeout do provedor com mensagem amigavel no checkout.

---

## 5. Sandbox / credenciais — o que o lider precisa providenciar

1. Criar conta no Melhor Envio Sandbox (`https://sandbox.melhorenvio.com.br`) — cadastro simplificado, R$10.000 fake pra testar etiquetas.
2. Gerar um token pessoal de acesso no painel da conta sandbox (suficiente pro spike). Guardar como `MELHOR_ENVIO_TOKEN` no `.env` do backend (nao commitar).
3. (So pra producao multiusuario depois) criar um Aplicativo -> obter `client_id` + `client_secret` -> implementar OAuth2 com refresh automatico (token 30d / refresh 45d).
4. Definir o CEP de origem da loja (Bento Goncalves/RS) como constante de config.
5. Preencher/backfill peso e dimensoes dos produtos (ver secao 3).

---

## Fontes (reconfirmar antes de codar)
- Melhor Envio — Calculo de fretes por produtos: https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos
- Melhor Envio — Introducao / autenticacao: https://docs.melhorenvio.com.br/reference/introducao-api-melhor-envio
- Melhor Envio — Solicitacao do token: https://docs.melhorenvio.com.br/reference/solicitacao-do-token
- Melhor Envio — Cotacao de fretes (fluxo): https://docs.melhorenvio.com.br/docs/cotacao-de-fretes
- Correios — Desenvolvedores / CWS: https://www.correios.com.br/atendimento/developers
- Correios — Manual API Preco: https://www.correios.com.br/atendimento/developers/manuais/manual-api-preco-1
- Correios — Portal CWS: https://cws.correios.com.br
