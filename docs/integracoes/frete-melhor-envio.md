# Frete real por CEP/peso — notas do spike F2-FRETE-SPIKE

Objetivo: substituir o frete fixo do checkout por cotacao real por CEP + peso/dimensoes.
Loja: Bento Goncalves/RS, envia pra todo o Brasil.

> **Status (22/10/2026) — implementado (só cotação; etiqueta e rastreio fora):**
> - Cliente: `backend/src/modules/shipping/melhorEnvio.ts` (Correios PAC/Sedex, serviços 1 e 2; cache 10 min; timeout cobre a requisição inteira). Config: `melhorEnvioConfig.ts` — valor inválido desliga a cotação com aviso, nunca derruba o boot.
> - Regra única: `shipping.service.ts` → `quoteForItems`, usada pela rota `POST /api/shipping/quote` (checkout, usuário logado) **e** por `ordersService.createFromCart`. O pedido cobra a mesma cotação, pelo CEP do endereço do pedido; `expectedShippingValue` do front é só conferência (diferença > R$ 0,01 → `409 SHIPPING_CHANGED` com as opções novas).
> - Resposta pública: `status` `ok` (cotação real) · `fixed` (Melhor Envio desligado → tabela fixa) · `unavailable` (ligado mas sem cotação → só retirada, com mensagem e "tentar de novo"). Códigos internos só no log.
> - Frete grátis (limite do admin ou cupom FREE_SHIPPING): PAC grátis; Sedex com desconto do valor do PAC da mesma cotação (paga só a diferença, nunca negativo).
> - Prazo exibido = prazo do serviço de entrega (sem prazo de preparação).
> - Pedido grava `shippingServiceId/Name`, `shippingCarrier`, `shippingDeadlineDays`, `shippingQuoteSource` (migration `20261022150000_order_shipping_quote`, colunas opcionais).
> - Produtos: peso/medidas obrigatórios no cadastro (formulário/API), regra em `backend/src/shared/physicalLimits.ts`; planilha antiga ainda cria sem medidas, com aviso e filtro "Sem medidas" no admin.
> - Melhorias futuras: teto de subsídio do frete grátis; prazo de preparação; etiqueta/rastreio pelo Melhor Envio.
>
> Fontes oficiais consultadas em 2026-09-15. Endpoints e campos podem mudar — reconfirmar na doc antes de codar.

---

## Homologação Sandbox das ETIQUETAS — 06/11/2026 (branch `feat/melhor-envio-etiquetas`)

Ambiente: backend local + Postgres isolado (`me_homolog`, 127.0.0.1), Melhor Envio **Sandbox** com OAuth dos 8 scopes, `MELHOR_ENVIO_LABELS_ALLOW_PRODUCTION=false`, `HOMOLOGATION_ONLY=true`. Somente pedidos artificiais, remetente sintético (CNPJ gerado) e destinatário fictício. Nenhuma credencial/banco de produção tocado. Evidências redigidas (sem token, documento, endereço, telefone ou e-mail) ficaram fora do Git.

**Cotação (Fase 1)** — `quoteAvailable=true`, scopes verificados no token. PAC = `id 1`, SEDEX = `id 2`.
- ⚠️ **CEP de origem precisa ser o do LOGRADOURO da loja.**
  - `95700000` = CEP **genérico** de Bento Gonçalves — **inadequado**: o ME respondeu `200` com `error: "Transportadora não atende este trecho."` em PAC e SEDEX para todos os destinos (→ checkout "só retirada"). Reconfirmado no fechamento.
  - `95703154` = CEP **operacional informado pela loja** (Rua 13 de Maio, 877). Configurado só no `.env` local (vem de `SHIPPING_ORIGIN_CEP`, nunca do código). Em produção, o mesmo valor precisa ir para o Render.
  - Cotações Sandbox com origem 95703154 (pacote 2× 1,25 kg 21×8×21, R$ 199,80; valores de Sandbox, não tarifas reais) — `quoteAvailable=true`, scope `shipping-calculate` aceito na prática (200 com OAuth):

    | Destino | PAC (id 1) | SEDEX (id 2) |
    |---|---|---|
    | 01310100 São Paulo/SP | R$ 30,51 · 7 d | R$ 45,75 · 3 d |
    | 20040002 Rio de Janeiro/RJ | R$ 33,96 · 8 d | R$ 61,16 · 4 d |
    | 69005000 Manaus/AM | R$ 44,88 · 21 d | R$ 102,96 · 6 d |
    | 90010000 Porto Alegre/RS | R$ 25,89 · 6 d | R$ 28,46 · 2 d |
    | 70040010 Brasília/DF | R$ 44,88 · 7 d | R$ 102,96 · 3 d |
  - O motivo do ME em cotação vazia vai para o log (`[melhor-envio] cotação sem PAC/Sedex (origem 957xx***): …`).
- Limites dos Correios observados: 42,3 kg 70×80×70 (R$ 30.000) → nenhum serviço (`"Peso ultrapassa o limite máximo de 30,00kg."` e, no PAC, `"Valor segurado ultrapassa o limite máximo de R$ 4.184,84."`). 29 kg 60×60×60 (R$ 9.000) → só SEDEX (R$ 455,93). **O PAC recusa valor segurado acima de R$ 4.184,84** — impressoras caras tendem a ter só SEDEX.
- **Sem serviço válido = só retirada**, nunca tabela fixa nem frete inventado; o pedido recusa PAC/SEDEX ausentes (409 `SHIPPING_CHANGED`). Coberto por testes com os formatos reais. **Evolução futura (não implementada):** outra transportadora (ex.: Jadlog) pelo próprio Melhor Envio para itens acima dos limites dos Correios.

**Carrinho → compra → geração → PDF → cancelamento (PAC e SEDEX)** — formatos reais:
- `POST /me/cart` 201: `{ id (UUID), protocol "ORD-…", service_id, price, quote, delivery_min/max, status "pending", … }`. `GET /me/orders/{id}` e `GET /me/orders/search?q=` (id ou protocolo) devolvem o item; busca **sem resultado = 204 sem corpo**.
- `POST /shipment/checkout` 200: `{ purchase: { id, protocol "PUR-…", total, status "paid", paid_at, transactions[ type "debit", status "authorized" ], orders[ { id, status "released", price } ] } }`. Status do envio pago: **`released`**.
- Checkout de etiqueta **já paga** → **204 sem corpo** (não o 422 documentado). 422 `"Existe uma ou mais orders que já foram pagas ou inválidas."` aparece para id removido/inexistente.
- `POST /shipment/generate` 200: `{ generate_key, [id]: { status: true, message: "Envio encaminhado para geração" } }`. **Assíncrono**: status continua `released`; `generated_at`, `tracking` (Correios) e `self_tracking` (ME) aparecem ~3–5 s depois. Gerar de novo durante/após a geração → **204 sem corpo**. Antes de pagar → 200 `{ status: false, message: "O Envio não está pago" }`.
- `GET /imprimir/pdf/{id}` 200: **lista** com URL pré-assinada S3 `https://me-0047-sandbox.s3.amazonaws.com/pdf/…?X-Amz-…` (`X-Amz-Expires=1800`), sem redirect; GET direto → `application/pdf`, `%PDF-`, ~92 KB, `server: AmazonS3`. Logo após gerar pode vir `404 "E-PRT-0007: Etiqueta pdf não processada."`; antes de gerar, `422 "E-PRT-0011"`. **O Sandbox gera PDF de PAC/Sedex** (a nota antiga "só Jadlog" estava errada). `GET /me/orders/{id}` também traz `files.1.{pdf,zpl,jpeg}` no mesmo host.
- `POST /shipment/print` (mode private) → `{ url: "https://sandbox.melhorenvio.com.br/portal/imprimir/<código>" }` — página HTML do portal (exige login no ME), não PDF.
- `POST /shipment/cancellable` → `{ [id]: { cancellable } }` (true pago/gerado; false no carrinho ou já cancelada). `POST /shipment/cancel` com `reason_id "2"` → `{ key, [id]: { canceled: true, status: "pending" } }`; repetir também responde `canceled: true`. `GET /me/orders/{id}` → `status "canceled"`, `canceled_at`. **`/shipment/tracking` continua mostrando `released` e `canceled_at` nulo após o cancelamento** — o workflow usa `GET /me/orders/{id}` (correto).
- Datas do ME vêm **sem fuso e em UTC** (`"2026-11-06 20:44:41"`).
- Erros: serviço inválido 422 (`service`); peso 0 → 422 (`volumes`, "entre 0.01 e 1000"); caixa acima do limite → **500** "Dimensões do objeto ultrapassam o limite da transportadora" (o validador local de 30 kg/100 cm barra antes); CEP inválido 422 (`to.postal_code`); endereço vazio 422; CPF inválido 422 (`to.document`); id inexistente: get 404 "Registro não encontrado.", generate 422 `orders.0`, cancel 422 `order.id`, tracking 200 `[]`. Scope ausente: `GET /me/balance` → 403 `"This action is unauthorized."` (→ `FORBIDDEN`).
- Postado/entregue/expirado: **não observáveis no Sandbox** (sem postagem física). Reembolso do cancelamento: não verificável por API com os scopes atuais (saldo exige outro scope) — conferir no painel/extrato na produção.

**Concorrência (Sandbox real)** — duplo clique em comprar (duas "instâncias"): 1 checkout, a outra recebe 409 `PURCHASE_IN_PROGRESS`; gerar em dobro: 1 chamada; cancelar em dobro: 1 cancelamento, a outra 409; compra repetida: 409 `ALREADY_PURCHASED`; confirmação expirada (10 min): 409 `CONFIRMATION_EXPIRED`; token inválido: 409 `CONFIRMATION_INVALID`; descarte de não paga: `removeFromCart` + `DISCARDED`. Rastreio Sandbox nunca vai para o pedido.

**Correções feitas com essa evidência:** datas sem fuso tratadas como UTC; `imprimir/pdf` aceita a lista; busca 204 = vazia; geração ambígua (204/timeout) reconcilia sozinha; "Verificar" não rebaixa etiqueta com geração aceita (LABEL_READY sem `generatedAt` até o ME confirmar); motivo do ME em cotação vazia no log; textos do painel sobre o PDF do Sandbox.

**Allowlist do PDF (aprovada e implementada no fechamento):** `melhorenvio.com.br` (+ subdomínios) em qualquer ambiente; **`me-0047-sandbox.s3.amazonaws.com` exato, só quando ambiente = sandbox E API = `https://sandbox.melhorenvio.com.br`**. HTTPS, porta 443, sem credenciais, sem IP/localhost/`.local`, sem `*.amazonaws.com`, sem outros buckets, cada redirect revalidado. Produção NÃO herda: host não autorizado → 502 `LABEL_FILE_HOST_BLOCKED` e o host (sem a URL assinada) vai para o log, para aprovação na primeira etiqueta real.
- Validação final pelo código real (sem bypass): PAC 91.996 bytes e SEDEX 92.768 bytes, `application/pdf`, `%PDF-`, HTTPS, host `me-0047-sandbox.s3.amazonaws.com`, sem redirect, evento `LABEL_FILE_DOWNLOADED`.
- Logo após gerar, o PDF pode não estar pronto: o ME responde 404 `E-PRT-0007 … Aguarde 3 minutos`, ou entrega a URL e o S3 ainda responde 404. Ambos → 409 `LABEL_FILE_NOT_READY` ("tente em 1 a 3 minutos"), sem registrar download. Visto na 1ª tentativa de PAC e de SEDEX; a 2ª (~4 s depois) baixou.

## Resultado da homologação Sandbox — 22/10/2026

- OAuth real autorizado pelo usuário somente para shipping-calculate. Callback concluiu a troca de code; admin do preview exibiu Conectado. Access/refresh persistidos com formato cifrado v1 (AES-256-GCM), validade ativa, sem needsReconnect ou lastError. Callback redireciona para APP_URL oficial; no preview, retornar à URL de configurações da branch para continuar os testes.
- Rotação exigiu recarregar as envs: o processo ainda usava o Client ID anterior; novo aplicativo Sandbox e env salva foram conferidos, callback do app corrigido para a rota completa e o mesmo SHA isolado 7583efc republicado. Nenhum secret/token foi incluído nesta evidência.
- Renovação real pelo botão admin: versão 0 para 1. Renovação automática no caminho de cotação: somente a data de expiração do registro OAuth Sandbox foi antecipada de forma controlada (com metadado original salvo fora do Git); uma nova cotação disparou refresh preventivo, versão 1 para 2, e o provedor restabeleceu a validade completa (> 7 dias). Nenhuma data artificial permaneceu. Reconnect não foi necessário; recusa/expiração e timeout continuam cobertos pelos testes automatizados existentes, sem provocar indisponibilidade no serviço público.
- Pacote sintético: 1 kg, 20 x 10 x 20 cm, valor R$ 100. CEP 01310100: PAC 22,64 / 7 dias úteis, Sedex 32,01 / 3 dias. CEP 69005000: PAC 33,59 / 21 dias, Sedex 66,42 / 6 dias. Mudança de CEP recotou corretamente. Após refresh automático, CEP 20040002: PAC 25,28 / 8 dias, Sedex 44,51 / 4 dias. Valores são do Sandbox, não tarifas de produção.
- Cupom grátis, CEP 69005000: PAC zero, Sedex 32,83 (66,42 - 33,59), retirada zero. Produto sem peso: unavailable e somente retirada. CEP curto: 400/CEP inválido. CEP 00000000: sem atendimento e somente retirada. Retirada sempre gratuita e nenhum pedido de teste criado.
- O limite real de frete grátis está em 0 (desativado). O cenário de R$ 400 manteve PAC 25,64/Sedex 35,01, corretamente sem benefício por valor. A regra de limite habilitado já passou nos testes controlados; não modificar settings públicos para forçar esse caso. O pacote admin acima do limite foi ajustado de R$ 10.000 para R$ 400, porque o alto valor excluía PAC; somente fixture de frontend, build/typecheck frontend aprovados novamente.
- Auditoria final: 81 produtos, 1 pedido e 1 item de pedido comparados ao backup, todos intactos. Três respostas públicas de frete seguem idênticas ao baseline pré-publicação, mesmo com OAuth conectado e renovado. Tracking inalterado, nenhuma etiqueta ou pagamento gerado.
- Backend temporário continua em 7583efc com isolamento seguro por padrão; main não recebeu merge, Auto-Deploy permanece desligado, envs continuam Sandbox. Backup e 24 migrations preservados. App de produção criado pelo usuário e verificado: 3DCommerce, site oficial, URL de testes no preview e callback oficial completo. O cadastro gerou Client ID/secret; nenhum valor foi divulgado. Não houve exigência adicional de aprovação na tela de cadastro. OAuth de produção não iniciado, envs não substituídas; escopo do backend permanece somente shipping-calculate. PR #14 promovido a Ready for review, sem merge.

---

## Isolamento temporário de homologação

- MELHOR_ENVIO_HOMOLOGATION_ONLY=true é o padrão seguro. Mantém GET público, cotação do carrinho e cálculo do pedido na tabela exata da main: PAC 24,90; Sedex 42,90; acima do limite PAC zero/Sedex 18; cupom FREE_SHIPPING zera ambos. Produtos sem medidas continuam compráveis. A configuração OAuth não ativa o frete público.
- POST /api/admin/integrations/melhor-envio/sandbox/quote exige autenticação ADMIN, rate limit, modo isolado e host Sandbox. Aceita apenas um pacote de simulação validado em memória; não grava produto, carrinho ou pedido. Reutiliza o cálculo/erros do serviço da feature e sua regra nova de PAC grátis/Sedex diferença.
- POST /api/admin/integrations/melhor-envio/sandbox/refresh permite comprovar a renovação real somente nesse modo, sem devolver tokens. Status retorna apenas metadados e a indicação de isolamento. Callback continua público com state de uso único.
- Card admin oferece simulação com CEP, cupom, limite e ausência de peso, além de renovação. Usar frontend da branch/preview para homologar; não é necessário substituir o frontend público.
- Somente após medidas reais, homologação e decisão de ativação de produção, definir MELHOR_ENVIO_HOMOLOGATION_ONLY=false. Isso também desativa as rotas de simulação. Não ativar frete Sandbox no checkout público.
- Rollback de código: redeploy do commit b216f28740be7ba5ba6f6f51396f8e0b440a1073 no Render; manter migrations aditivas. Deploy por SHA preserva branch main e o Render informa que desliga Auto-Deploy para evitar substituição acidental. Restauração de Auto-Deploy é uma decisão operacional posterior.
- Isolamento verificado por HTTP com middleware real: anônimo 401, cliente 403, produção/mode off 404; requisições comuns/forjadas e pedidos sem medidas não chamam Melhor Envio; preços e cupom legado preservados. Gates após mudança: 312 testes aprovados, 11 ignorados, typecheck/build backend e typecheck/build frontend aprovados. Backend publicado temporariamente por SHA 7583efc, sem merge e sem trocar branch main; Auto-Deploy desativado pelo Render. Após publicação: saúde 200, callback sem state 302 e rotas de simulação/renovação sem login 401. Três respostas públicas (subtotal normal, acima do limite e cupom grátis) idênticas ao baseline anterior. Frontend público não publicado. OAuth e cotações reais aguardam login admin no preview e confirmação da rotação do secret Sandbox.

---

## Auditoria de preparação para produção — 22/10/2026

- Branch auditada: feat/frete-melhor-envio. OAuth implementado em 9c92d70, com escopo shipping-calculate, tokens cifrados, state de uso único e refresh automático. As recomendações do spike abaixo são históricas; OAuth já não é uma etapa futura.
- Sandbox: aplicativo 3DCommerce existente; site e callback conferidos. Client ID e secret do Render correspondem a esse aplicativo. Isso confirma configuração, não homologação ponta a ponta.
- Render: serviço existente em main, commit publicado b216f28. Todas as sete variáveis exigidas estão presentes; base Sandbox, callback correto, chave de cifragem em formato válido e CEP de origem com oito dígitos. Nenhum valor foi alterado, nenhum deploy foi executado.
- Smoke do backend publicado: /api/health retorna 200; /api/integrations/melhor-envio/callback sem parâmetros retorna 401. O callback OAuth desta branch ainda não está publicado. Autorização, troca de code, refresh real e cotações PAC/Sedex com CEPs diferentes continuam pendentes; não classificar o Sandbox como homologado.
- Produção Melhor Envio: conta acessível, nenhum aplicativo cadastrado. Cadastro disponível no painel, ainda não submetido. Concluir o Sandbox antes de criar/ativar produção; a criação de credenciais pelo navegador exige confirmação no momento da ação. Não substituir envs Sandbox antes disso.
- Neon: identidade conferida contra DATABASE_URL do serviço Render. As 22 migrations anteriores estavam concluídas, sem falhas ou divergências de conteúdo (diferenças de checksum decorrentes de CRLF/LF conferidas). Backup JSON/SQL gerado com o script existente antes da aplicação, na pasta ignorada backups/.
- Aplicadas somente 20261022150000_order_shipping_quote e 20261023120000_integration_oauth. Prisma migrate status: atualizado, 24 migrations. Cinco novas colunas opcionais de orders e tabelas integration_credentials/oauth_states verificadas. Todos os registros anteriores foram comparados ao backup e permaneceram intactos, incluindo 81 produtos e 1 pedido.
- Gates já concluídos nesta finalização: 303 testes backend aprovados, 11 ignorados; typecheck/build backend, typecheck/build frontend e Prisma validate aprovados. Não repetidos nesta retomada, pois não houve alteração de código. Avisos existentes: bundle frontend e VITE_SITE_URL ausente no ambiente de build local.
- Nenhum produto real foi modificado para testes. Peso e dimensões dos produtos continuam sob responsabilidade da 3DCommerce.
- Próximo passo operacional: aprovação humana de uma publicação controlada que disponibilize o callback, homologação real Sandbox e só então cadastro/conexão de produção. Merge e deploy finais permanecem manuais.

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
User-Agent: <MELHOR_ENVIO_USER_AGENT>   (ex.: 3DCommerce (contato@sualoja.com.br))
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
