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

## Resultado da homologação Sandbox — 22/10/2026

- OAuth real autorizado pelo usuário somente para shipping-calculate. Callback concluiu a troca de code; admin do preview exibiu Conectado. Access/refresh persistidos com formato cifrado v1 (AES-256-GCM), validade ativa, sem needsReconnect ou lastError. Callback redireciona para APP_URL oficial; no preview, retornar à URL de configurações da branch para continuar os testes.
- Rotação exigiu recarregar as envs: o processo ainda usava o Client ID anterior; novo aplicativo Sandbox e env salva foram conferidos, callback do app corrigido para a rota completa e o mesmo SHA isolado 7583efc republicado. Nenhum secret/token foi incluído nesta evidência.
- Renovação real pelo botão admin: versão 0 para 1. Renovação automática no caminho de cotação: somente a data de expiração do registro OAuth Sandbox foi antecipada de forma controlada (com metadado original salvo fora do Git); uma nova cotação disparou refresh preventivo, versão 1 para 2, e o provedor restabeleceu a validade completa (> 7 dias). Nenhuma data artificial permaneceu. Reconnect não foi necessário; recusa/expiração e timeout continuam cobertos pelos testes automatizados existentes, sem provocar indisponibilidade no serviço público.
- Pacote sintético: 1 kg, 20 x 10 x 20 cm, valor R$ 100. CEP 01310100: PAC 22,64 / 7 dias úteis, Sedex 32,01 / 3 dias. CEP 69005000: PAC 33,59 / 21 dias, Sedex 66,42 / 6 dias. Mudança de CEP recotou corretamente. Após refresh automático, CEP 20040002: PAC 25,28 / 8 dias, Sedex 44,51 / 4 dias. Valores são do Sandbox, não tarifas de produção.
- Cupom grátis, CEP 69005000: PAC zero, Sedex 32,83 (66,42 - 33,59), retirada zero. Produto sem peso: unavailable e somente retirada. CEP curto: 400/CEP inválido. CEP 00000000: sem atendimento e somente retirada. Retirada sempre gratuita e nenhum pedido de teste criado.
- O limite real de frete grátis está em 0 (desativado). O cenário de R$ 400 manteve PAC 25,64/Sedex 35,01, corretamente sem benefício por valor. A regra de limite habilitado já passou nos testes controlados; não modificar settings públicos para forçar esse caso. O pacote admin acima do limite foi ajustado de R$ 10.000 para R$ 400, porque o alto valor excluía PAC; somente fixture de frontend, build/typecheck frontend aprovados novamente.
- Auditoria final: 81 produtos, 1 pedido e 1 item de pedido comparados ao backup, todos intactos. Três respostas públicas de frete seguem idênticas ao baseline pré-publicação, mesmo com OAuth conectado e renovado. Tracking inalterado, nenhuma etiqueta ou pagamento gerado.
- Backend temporário continua em 7583efc com isolamento seguro por padrão; main não recebeu merge, Auto-Deploy permanece desligado, envs continuam Sandbox. Backup e 24 migrations preservados. App de produção: cadastro preparado, criação de credenciais depende de confirmação humana no momento da ação; não houve troca de envs para produção.

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
