# Checklist de produção — 3DCommerce

Estado da loja em produção (Vercel front + Render back + Neon + Vercel Blob + Mercado Pago Orders API).
Revisado em 21/10/2026 contra o código da `main`. Configuração das contas: [CONFIGURAR-CLIENTE.md](CONFIGURAR-CLIENTE.md) · deploy: [CHECKLIST-DEPLOY.md](CHECKLIST-DEPLOY.md).

---

## Implementado (código na `main`)

**Vendas e pagamento**
- [x] Checkout transparente Mercado Pago (Orders API): cartão, Pix e boleto
- [x] Webhook assinado (evento *Order*) + reconciliação pelo cron e por `POST /api/admin/payments/reconcile`
- [x] Estorno/cancelamento pelo admin com reposição de estoque e cupom
- [x] Troca de forma de pagamento cancela a cobrança anterior; "Pagar agora" em Meus pedidos (`/pagar/:orderId`)
- [x] Preço, desconto Pix e frete recalculados no backend; total exibido vem da API
- [x] Estoque baixa só no pagamento aprovado; pedido sem estoque recebe `[REVISAR ESTOQUE]`
- [x] Expiração de pedidos não pagos (48h; boleto 96h) via GitHub Actions
- [x] Cupons (percentual, valor, frete grátis)

**Catálogo e conteúdo**
- [x] Produtos com mídias (imagens/vídeo) no Vercel Blob, compressão no admin, importação/exportação Excel, exclusão em lote
- [x] Categorias com imagem, flags de menu/home e categoria sazonal com cores próprias
- [x] Hero em carrossel, banners, depoimentos, Instagram, YouTube, newsletter, bloco de confiança — tudo editável
- [x] Blog com conteúdo e capas editáveis no admin (Markdown)
- [x] Catálogo e imagens refeitos após a migração para o Blob (imagens antigas perdidas **não** são mais pendência)

**Clientes**
- [x] Cadastro com verificação de e-mail, consentimento LGPD (data + versão), recuperação de senha
- [x] Carrinho de visitante, login com retorno (`?redirect=`), endereço salvo, CEP automático, CPF validado
- [x] Meus pedidos com rastreio (SeuRastreio)
- [x] E-mails transacionais (cadastro, pedido, pagamento, envio, senha) com timeout

**Admin e operação**
- [x] Painel protegido (JWT + papel ADMIN), dashboard com faturamento real
- [x] Pedidos: status com transições validadas, rastreio, estorno; Orçamentos, Mensagens, Scripts de WhatsApp
- [x] `npm run check:config` e avisos de configuração no boot do backend

**SEO**
- [x] Metas por página, Open Graph (PNG), `robots.txt`, sitemap estático + dinâmico da API, GA4 só com consentimento

---

## Conferência periódica (operação)

- [ ] `npm run check:config` com as envs de produção → 0 erros
- [ ] Mercado Pago com credenciais de **produção** e webhook apontando para o domínio de produção do backend
- [ ] Secrets do GitHub (`CRON_SECRET`, `BACKEND_URL`) válidos — conferir a última execução em **Actions → Expirar pedidos não pagos**
- [ ] Novas migrations aplicadas no Neon (`npx prisma migrate status`) **antes** de publicar código que depende delas
- [ ] Compra real de baixo valor testada e estornada após mudanças no checkout

---

## Pendências reais / limitações conhecidas

| Item | Situação |
|---|---|
| **Frete por CEP** | Não implementado. Regra fixa PAC/Sedex/retirada. Estudo: [docs/integracoes/frete-melhor-envio.md](docs/integracoes/frete-melhor-envio.md) |
| **NF-e** | Não existe emissão automática; a nota é emitida fora do sistema |
| **Render Free** | Dorme após ~15 min: primeiro webhook/cron pode atrasar (o Mercado Pago reenvia; o cron tenta 3x). Para movimento real, plano pago |
| **SMTP no Render** | O plano Free bloqueia portas SMTP; com Google Workspace via SMTP é preciso plano pago, ou usar Brevo (API HTTPS) |
| **Arquivos > 4 MB** | Limite de 4 MB por arquivo. STL grande no orçamento precisa ir pelo WhatsApp |
| **Rate limit em memória** | Por instância; com várias instâncias fica mais frouxo (mover para Redis se houver abuso) |
| **JWT em `localStorage`** | Aceitável para o MVP; cookies httpOnly seria endurecimento adicional |
| **`VITE_SEURASTREIO_API_KEY`** | Vai para o bundle público; usar chave sem custo crítico ou mover a consulta para o backend |
| **`npm audit` do front** | Alerta em `esbuild`/`vite` restrito ao dev server; corrigir exige upgrade com breaking changes |
| **Módulo `pix-inter`** | Código Banco Inter/mock desligado (sem rotas). As tabelas `payments`/`payment_events` existem sem uso |
