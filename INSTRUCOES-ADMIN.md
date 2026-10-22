# Manual do Painel Administrativo — 3DCommerce

Guia rápido para operar a loja. Tudo o que você altera no painel é salvo no banco de dados e aparece no site imediatamente, em qualquer computador.

---

## Acesso

- Endereço: **https://www.3dcommerce.com.br/admin/login**
- Login: o e-mail e a senha de administrador entregues pela G-Rec (por canal seguro).
- Esqueceu a senha? Use **Esqueci minha senha** em `/esqueci-senha` com o e-mail do admin — o link chega por e-mail.

---

## Seções do painel

| Seção | Para que serve |
|---|---|
| **Dashboard** | Faturamento (só pedidos pagos), pedidos recentes, estoque baixo |
| **Produtos** | Cadastrar, editar, ativar/desativar, fotos e vídeo, importar/exportar Excel |
| **Categorias** | Criar categorias, imagem do card na home, mostrar no menu / na home |
| **Categoria Sazonal** | Campanha especial (Black Friday, Natal...): banner, textos e cores |
| **Banners** | Banners do carrossel principal (hero) e promocionais |
| **Pedidos** | Status, código de rastreio, cancelamento e estorno |
| **Orçamentos** | Pedidos de orçamento enviados pelo site (com arquivos) |
| **Mensagens** | Formulário de contato e inscritos na newsletter |
| **Cupons** | Desconto percentual, valor fixo ou frete grátis |
| **Depoimentos** | Avaliações exibidas na home |
| **Scripts** | Mensagens prontas para atendimento no WhatsApp |
| **Blog** | Texto (Markdown) e capa de cada artigo |
| **Configurações** | Dados da loja, logo, textos da home e Sobre, SEO, redes sociais, Instagram, YouTube, newsletter, bloco de confiança, rodapé, frete grátis e desconto Pix |

---

## Tarefas comuns

### Imagens
- Envie arquivos **PNG, JPG ou WEBP de até 4 MB** (o painel reduz fotos grandes automaticamente).
- Produtos aceitam várias imagens (a primeira é a principal) e vídeo.
- As imagens ficam no armazenamento em nuvem da loja (Vercel Blob).

### Produtos
1. **Produtos → Novo produto**: nome, marca, descrição, preço normal e promocional, estoque, categoria, material, peso/dimensões.
2. **Modo de compra**: compra direta, só orçamento (WhatsApp) ou ambos.
3. Marque **Destaque** para aparecer na vitrine da home e **Ativo** para aparecer na loja.
4. Para tirar da loja sem apagar, desmarque **Ativo**. **Excluir** apaga o produto e as fotos de vez (pedidos antigos continuam com nome e preço).
5. **Exportar/Importar Excel**: edite em planilha e reimporte. Célula vazia não altera o produto.

### Categorias e campanha sazonal
- **Categorias**: nome, descrição, imagem do card e se aparece no menu e/ou na home.
- **Categoria Sazonal**: ative a campanha, preencha título, descrição, banner e as cores do banner (início, fim e texto). Desative quando a campanha acabar.

### Banners
- Posição **Hero** (carrossel do topo) ou **Promo**. O tempo de troca do carrossel é ajustado na própria tela de Banners.

### Pedidos
| Status | Significado |
|---|---|
| Novo | Pedido criado, aguardando pagamento |
| Pago | Pagamento aprovado (o Mercado Pago confirma sozinho) |
| Em separação | Pedido sendo preparado |
| Enviado | Saiu para entrega — informe o **código de rastreio** |
| Concluído | Cliente recebeu |
| Cancelado | Cancelado (pedidos não pagos expiram em 48h; boleto em 96h) |

- **Estornar e cancelar** devolve o dinheiro pelo Mercado Pago e repõe o estoque.
- O estoque só baixa quando o pagamento é aprovado. Se aparecer **[REVISAR ESTOQUE]**, o pedido foi pago sem estoque suficiente.
- O cliente recebe e-mail quando o pedido é criado, pago, enviado ou cancelado.

### Blog
- Edite o texto de cada artigo em Markdown (títulos `##`, listas, **negrito**, links) e troque a capa. **Restaurar texto padrão** volta ao texto original.

### Configurações
- Nome, WhatsApp (só dígitos, `55` + DDD + número), e-mail, endereço, CNPJ, logo, textos e SEO. A Política de Privacidade usa esses dados automaticamente.

---

## O que o painel não faz

- **Frete**: valores fixos de PAC/Sedex/retirada (sem cotação por CEP). O valor do frete grátis é configurável.
- **Nota fiscal**: não há emissão automática de NF-e.

---

## Apoio técnico

Dúvidas ou problemas: fale com a **G-Rec Company**.
