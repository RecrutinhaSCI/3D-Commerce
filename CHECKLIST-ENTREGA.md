# Checklist de Entrega — 3DCommerce

Uso interno da **G-Rec Company** para garantir entrega profissional ao cliente.

---

## 1. Código e build

- [x] Build passa sem erros: `npm run build`
- [x] `tsc -b` sem erros TypeScript
- [x] Zero warnings de imports não utilizados nos arquivos principais
- [x] Code-splitting por rotas funcionando (26 chunks)
- [x] Bundle principal abaixo de 200kB gzip
- [x] Sem erros no console em runtime
- [x] Sem `console.log` de debug esquecidos

## 2. Funcionalidades

### Público
- [x] Home renderiza todas as 12 seções
- [x] Hero animado funcionando
- [x] Mega menu desktop com hover bridge corrigido
- [x] Drawer mobile funcionando
- [x] Busca por querystring funciona
- [x] Filtros (material, marca, preço, em estoque, ofertas) funcionam
- [x] 6 ordenações funcionam
- [x] Página de produto renderiza galeria, variações e preços
- [x] Modos `direct`, `quote` e `both` funcionam corretamente
- [x] Carrinho persiste em `localStorage` (chave `3dc-cart`)
- [x] Cupons demo (`BEMVINDO10`, `PIX5`, `FRETE3D`) funcionam
- [x] Checkout 4 passos com Zod
- [x] Pedido salvo no admin ao finalizar checkout
- [x] Orçamento via WhatsApp funcional
- [x] WhatsApp flutuante em todas as páginas
- [x] Newsletter mostra toast de sucesso
- [x] Contato dispara link de WhatsApp

### Admin
- [x] Login funcional (mock)
- [x] Dashboard com stats e sparklines
- [x] CRUD de produtos (criar/editar/deletar/toggle ativo)
- [x] CRUD de categorias
- [x] Categoria sazonal editável com preview
- [x] CRUD de banners com preview de gradiente
- [x] Mudança de status em pedidos
- [x] Configurações da loja refletem no site público
- [x] Botão "Restaurar dados" funciona
- [x] Drawer mobile do admin renderiza navegação

## 3. Qualidade visual

- [x] Hero impactante
- [x] Cards de produto com hover refinado
- [x] Cards de categoria com microinterações
- [x] Tipografia consistente (eyebrow + section-title)
- [x] Cores fiéis à paleta (off-white, cinza, preto, grafite, ciano)
- [x] Animações suaves (Framer Motion)
- [x] Sem visual de template cru
- [x] Sem botões sem ação
- [x] Sem placeholders óbvios

## 4. Responsividade

- [x] Mobile (375px) — todas as páginas
- [x] Tablet (768px) — todas as páginas
- [x] Desktop (1024px+) — todas as páginas
- [x] Mega menu desktop não quebra
- [x] Drawer mobile abre/fecha corretamente
- [x] Cards de produto: 2/3/4 colunas conforme breakpoint
- [x] Checkout stack vertical no mobile
- [x] Admin sidebar vira drawer no mobile

## 5. SEO básico

- [x] `<title>` dinâmico por página (via `useSEO`)
- [x] `<meta description>` dinâmica
- [x] Open Graph (`og:type`, `og:title`, `og:image`, etc.)
- [x] Twitter Cards
- [x] `lang="pt-BR"` no html
- [x] `robots.txt` com `Disallow: /admin/`
- [x] `sitemap.xml` com 19 URLs prioritárias
- [x] Imagem `og.svg` (1200×630)
- [x] Favicon configurado

## 6. Acessibilidade básica

- [x] `role="dialog"` + `aria-modal="true"` em Modal e Drawer
- [x] `aria-label` em botões só com ícone
- [x] Focus ring visível em todos os elementos interativos
- [x] Contraste mínimo respeitado nos textos primários
- [x] Imagens decorativas com `aria-hidden`

## 7. Documentação

- [x] `README.md` final
- [x] `CHECKLIST-ENTREGA.md` (este arquivo)
- [x] `CHECKLIST-DEPLOY.md`
- [x] `ROTEIRO-DEMO.md`
- [x] `RESUMO-COMERCIAL.md`
- [x] `ROADMAP-FASE-2.md`
- [x] `INSTRUCOES-ADMIN.md`
- [x] `.gitignore` configurado

## 8. Pré-apresentação ao cliente

> Contas e dados do cliente (Mercado Pago, SMTP, domínio, admin): seguir [CONFIGURAR-CLIENTE.md](CONFIGURAR-CLIENTE.md) e fechar com `npm run check:config` sem erros.

- [ ] Credenciais de produção do Mercado Pago + webhook cadastrados
- [ ] SMTP do cliente configurado (e-mails de pedido/pagamento/senha)
- [ ] Admin de produção criado com `ADMIN_PASSWORD` própria (sem `admin123`)
- [ ] `VITE_SITE_URL`, `APP_URL` e `CORS_ORIGIN` com o domínio real
- [ ] Compra real via Pix testada e estornada

- [ ] Verificar versão final pelo `git log` ou release
- [ ] Logo real do cliente substituída (se entregue)
- [ ] WhatsApp do cliente real configurado em `/admin/configuracoes` e/ou em `src/config/site.ts`
- [ ] Texto institucional ajustado
- [ ] CNPJ e endereço conferidos
- [ ] Demo testada em navegador anônimo (estado limpo)
- [ ] Demo testada em mobile real
- [ ] `npm run build` rodado uma última vez
- [ ] `dist/` enviado/deployado em ambiente acessível ao cliente
- [ ] Mensagem de entrega no WhatsApp pronta

## 9. Pós-aprovação

- [ ] Repositório GitHub criado (privado)
- [ ] Deploy em produção (Vercel/Netlify)
- [ ] Domínio configurado
- [ ] HTTPS ativo
- [ ] Cliente treinado no admin (vídeo curto ou call de 15 min)
- [ ] Pacote de mensalidade (hospedagem + suporte) confirmado

---

**Status atual:** todas as caixas do código estão marcadas. Itens marcados como `[ ]` dependem de dados do cliente e do momento de deploy.
