# Checklist de entrega — 3DCommerce

Uso interno da **G-Rec Company** para fechar a entrega ao cliente. Estado técnico detalhado em [CHECKLIST-PRODUCAO.md](CHECKLIST-PRODUCAO.md).

---

## 1. Código e build

- [ ] `npm run build` (raiz) sem erros
- [ ] `cd backend && npm run typecheck && npm test` sem erros
- [ ] Deploy da `main` *Ready* na Vercel e *Live* no Render
- [ ] Sem `.env` versionado; `.env.example` só com placeholders

## 2. Configuração de produção

- [ ] `npm run check:config` com as envs de produção → 0 erros
- [ ] Mercado Pago com credenciais de **produção** + webhook (evento *Order*) cadastrado
- [ ] E-mail transacional enviando (Google Workspace SMTP ou Brevo) — testar cadastro e "Esqueci minha senha"
- [ ] `BLOB_READ_WRITE_TOKEN` no Render — upload de teste com URL do Blob
- [ ] `VITE_SITE_URL`, `APP_URL` e `CORS_ORIGINS` com `https://www.3dcommerce.com.br`
- [ ] Admin de produção com senha própria (nunca `admin123`)
- [ ] Secrets `CRON_SECRET` e `BACKEND_URL` no GitHub; última execução do cron OK

## 3. Fluxos a validar (navegador anônimo + celular real)

**Loja**
- [ ] Home, catálogo, categoria, produto, busca e filtros
- [ ] Carrinho → checkout → Pix / cartão / boleto
- [ ] Cadastro, verificação de e-mail, login, Meus pedidos, "Pagar agora"
- [ ] Orçamento com arquivo, contato, newsletter, WhatsApp flutuante
- [ ] Blog (lista e artigo), páginas institucionais, banner de cookies

**Admin**
- [ ] Produto: criar, editar mídias, importar/exportar Excel, desativar, excluir
- [ ] Categoria: imagem, flags de menu/home; Categoria Sazonal com cores
- [ ] Banners do hero, depoimentos, Instagram/YouTube/newsletter em Configurações
- [ ] Blog: editar artigo e capa
- [ ] Pedido: mudar status, código de rastreio, estorno
- [ ] Orçamentos, Mensagens, Cupons, Scripts

## 4. Conteúdo do cliente

- [ ] Nome, WhatsApp, e-mail, endereço, CNPJ, Instagram e logo em **/admin/configuracoes**
- [ ] Textos da home, Sobre, SEO e rodapé revisados
- [ ] Sem textos/produtos de exemplo visíveis
- [ ] Parcelamento "sem juros" coerente com a conta do Mercado Pago (`src/config/site.ts` → `installments`)
- [ ] Cliente ciente: frete por tabela fixa e sem emissão automática de NF-e

## 5. Entrega

- [ ] Domínio com HTTPS e sitemap enviado ao Google Search Console
- [ ] Cliente treinado no painel ([INSTRUCOES-ADMIN.md](INSTRUCOES-ADMIN.md))
- [ ] Acessos entregues por canal seguro (nunca em documento versionado)
- [ ] Plano de suporte/hospedagem mensal combinado
