# Checklist para produção — 3DCommerce

Plano para deixar a loja pronta para vender de verdade (Vercel + Neon + Mercado Pago).
Baseado na auditoria de 06/10/2026. Configuração das contas do cliente: [CONFIGURAR-CLIENTE.md](CONFIGURAR-CLIENTE.md).

## Etapa 1 — Antes de qualquer venda

- [x] Uploads no **Vercel Blob** (produto, banner, logo, depoimento, orçamento) — código pronto; falta criar o Blob Store na Vercel (gera `BLOB_READ_WRITE_TOKEN`)
- [x] **Meus pedidos** buscando `/api/me/orders` (hoje fica vazio ao recarregar)
- [x] **Desconto Pix** aplicado no backend (% do admin sobre os produtos, frete fora)
- [x] **Preço** recalculado na criação do pedido e total exibido vindo da API
- [x] **Frete** calculado no backend + modalidade (PAC/Sedex/retirada) salva no pedido
- [x] Remover o texto "Ambiente de teste (sandbox)" da tela de sucesso
- [x] Migration de backfill: `stock_applied = true` nos pedidos antigos (`20261006120000_checkout_hardening`)
- [ ] ⏳ **Você:** aplicar as migrations no **Neon** (branch de backup antes) — 6 pendentes, comandos na seção 4 do CONFIGURAR-CLIENTE.md
- [ ] ⏳ **Você:** na Vercel (backend) criar o Blob Store, cadastrar `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` (Production e Preview) e conferir o entrypoint no log de build

## Etapa 2 — Operação da loja

- [x] Estorno / cancelamento pelo admin via API do Mercado Pago (com reposição de estoque)
- [x] Cancelar a cobrança anterior ao trocar de forma de pagamento (evitar cobrança dupla)
- [x] Expirar pedidos não pagos (48h; boleto 96h) via **Vercel Cron** e devolver o cupom — falta só `CRON_SECRET` na Vercel
- [x] Botão "Pagar agora" em Meus pedidos (página /pagar/:orderId: cartão, novo Pix ou boleto)
- [x] Timeout no envio de e-mail (SMTP)
- [x] Admin marcar pedido como pago → baixa estoque; validar transições de status
- [x] Corrigir criação de produto no admin (id real, campos de peso/dimensões)
- [x] Admin de pedidos: mostrar "[REVISAR ESTOQUE]", erros reais, atualizar lista

## Etapa 3 — Conversão e qualidade

- [ ] Carrinho de visitante + login voltando para a página de origem
- [x] Endereço do cliente salvo no backend (GET/PUT /api/me/address)
- [x] CEP automático (ViaCEP) e CPF validado e salvo no pedido (migration `20261006150000_order_customer_cpf`)
- [x] Consentimento LGPD gravado (data + versão) + reenvio do e-mail de verificação
- [x] Dashboard com faturamento real (só pedidos pagos, mês corrente e últimos 7 dias)
- [x] Parcelamento consistente (produto, "Como comprar" e Brick) — `site.installments`
- [ ] Newsletter e formulário de contato salvando no backend
- [ ] SEO: sitemap com produtos, imagem de compartilhamento PNG, analytics com consentimento

## Go-live

- [ ] `npm run check:config` sem erros
- [ ] Compra real via Pix testada e estornada
- [ ] Merge da branch `api-mercado-pago` na `main`
