# AGENTS.md — Padrão G-Rec Company

Este arquivo define as regras, padrões e contexto que o Codex deve seguir em projetos da G-Rec Company.

Use este arquivo na raiz de cada projeto novo.

---

## 1. Contexto da G-Rec Company

A G-Rec Company é uma empresa de desenvolvimento web focada em criar soluções digitais para empresas locais e pequenos negócios.

A G-Rec desenvolve:

- Sites institucionais
- Landing pages
- Sistemas administrativos
- SaaS
- Dashboards
- Catálogos digitais
- E-commerces
- Automações simples
- Projetos personalizados para nichos específicos

O objetivo principal é criar projetos bonitos, funcionais, editáveis, vendáveis e fáceis de manter.

---

## 2. Identidade e posicionamento

Nome correto da empresa:

```txt
G-Rec Company
```

Tom dos projetos:

- Moderno
- Profissional
- Comercial
- Claro
- Direto
- Confiável
- Visualmente forte

Prioridades da G-Rec:

1. Entregar valor real ao cliente.
2. Criar projetos com boa aparência e boa usabilidade.
3. Evitar soluções frágeis ou difíceis de manter.
4. Pensar sempre em apresentação, venda e entrega.
5. Transformar protótipos em produtos reais.

---

## 3. Regra principal de trabalho

Antes de alterar qualquer arquivo:

1. Entenda a estrutura do projeto.
2. Leia arquivos importantes como `package.json`, `README.md`, `src`, `app`, `pages`, `components`, `services`, `lib`, `routes`, `prisma`, `supabase` ou equivalentes.
3. Identifique a stack usada.
4. Preserve o padrão visual e técnico existente.
5. Evite refatorações grandes sem necessidade.
6. Não quebre funcionalidades já prontas.

Sempre que fizer alterações importantes:

1. Explique o que foi feito.
2. Liste arquivos alterados.
3. Informe como testar.
4. Rode build, lint ou teste se existirem.
5. Aponte riscos ou pendências.

---

## 4. Stack comum

Projetos da G-Rec podem usar:

### Frontend

- React
- Vite
- TypeScript
- JavaScript
- HTML
- CSS
- Tailwind CSS
- Zustand
- Axios
- React Router

### Backend

- Node.js
- Express
- TypeScript
- JavaScript
- Prisma
- PostgreSQL
- Neon
- Supabase
- JWT
- Bcrypt
- Multer

### Deploy

- Vercel
- Render
- Netlify
- Supabase
- Neon
- GitHub

---

## 5. Padrão visual esperado

Todo projeto deve buscar:

- Interface moderna
- Boa hierarquia visual
- Botões claros
- CTAs bem posicionados
- Responsividade mobile
- Espaçamentos consistentes
- Tipografia agradável
- Cores coerentes com a identidade do cliente
- Animações leves, sem exagero
- Aparência profissional, não genérica

Evite:

- Layout com cara de template cru
- Textos genéricos demais
- Botões sem função
- Seções desalinhadas
- Excesso de animação
- Contraste ruim
- Componentes quebrados no mobile

---

## 6. Padrão comercial

Ao desenvolver ou revisar um projeto, pense também como produto vendável.

Sempre considere:

- Qual dor do cliente o projeto resolve?
- O que aumenta a percepção de valor?
- O que precisa aparecer em vídeo demonstrativo?
- O que precisa estar editável pelo admin?
- Quais informações precisam ser personalizadas?
- O que ainda parece fictício?
- O que impede a entrega?
- O que pode virar mensalidade de suporte/hospedagem?

---

## 7. Regras para landing pages e sites públicos

Toda landing page ou site institucional deve ter, quando fizer sentido:

1. Hero forte
2. Headline clara
3. Subheadline objetiva
4. CTA principal
5. Benefícios
6. Serviços/produtos
7. Prova social ou autoridade
8. Processo de trabalho
9. FAQ
10. CTA final
11. WhatsApp funcionando
12. Instagram/redes sociais
13. SEO básico
14. Responsividade mobile

CTAs devem ser claros, por exemplo:

```txt
Solicitar orçamento
Falar no WhatsApp
Conhecer serviços
Agendar demonstração
```

---

## 8. Regras para sistemas administrativos

Painéis admin devem ter:

- Login
- Proteção de rotas
- Dashboard
- Listagem
- Criar
- Editar
- Excluir
- Loading
- Estado vazio
- Confirmação antes de excluir
- Feedback visual
- Tratamento de erro
- Layout responsivo
- Dados persistentes quando houver backend ou Supabase

Evite:

- Botões sem ação
- Dados que somem sem motivo
- Exclusão sem confirmação
- Rotas admin abertas
- Dashboard quebrado
- Formulários sem validação mínima

---

## 9. Regras para backend e banco

Quando houver backend:

- Manter rotas organizadas
- Separar controllers/services quando o projeto já usa esse padrão
- Validar entradas importantes
- Tratar erros
- Não expor secrets
- Usar `process.env`
- Preservar contratos da API
- Garantir CORS correto
- Proteger rotas privadas

Quando houver Prisma/PostgreSQL:

- Revisar `schema.prisma`
- Usar relações claras
- Criar migrations com cuidado
- Rodar `npx prisma generate` quando necessário
- Cuidar de seeds
- Evitar apagar dados sem necessidade

Quando houver Supabase:

- Conferir `VITE_SUPABASE_URL`
- Conferir `VITE_SUPABASE_ANON_KEY`
- Considerar RLS
- Separar leitura pública de edição privada
- Revisar Storage quando houver upload
- Não inventar chaves reais

---

## 10. Segurança básica

Sempre verificar:

- `.env` não deve ir para GitHub
- Criar `.env.example` quando necessário
- Não expor tokens privados
- Não expor senhas
- Não deixar admin sem proteção
- Não deixar rotas críticas abertas
- Não usar CORS totalmente aberto em produção sem necessidade
- Não registrar dados sensíveis em logs
- Não deixar secrets hardcoded no frontend

---

## 11. Deploy

Antes de preparar deploy, verificar:

- `package.json`
- Scripts de `dev`, `build`, `start`
- Variáveis de ambiente
- `.env.example`
- Build local
- Configuração da Vercel/Render/Netlify
- Rotas SPA
- URLs de API
- CORS
- Banco de dados
- Prisma generate, se aplicável

Comandos comuns, usar apenas se existirem:

```bash
npm install
npm run dev
npm run build
npm run lint
npm run test
npx prisma generate
npx prisma migrate dev
npx prisma studio
```

---

## 12. GitHub

Antes de subir projeto:

- Garantir `.gitignore`
- Garantir que `.env` não será enviado
- Criar `.env.example`
- Criar ou atualizar README
- Remover arquivos temporários
- Não enviar `node_modules`
- Não enviar build desnecessário
- Fazer commit com mensagem clara

Exemplo de commit:

```bash
git add .
git commit -m "feat: estrutura inicial do projeto"
git push origin main
```

---

## 13. README

Todo projeto comercial deve ter README com:

1. Nome do projeto
2. Descrição
3. Funcionalidades
4. Tecnologias
5. Como rodar localmente
6. Variáveis de ambiente
7. Scripts disponíveis
8. Deploy
9. Observações para cliente ou admin

---

## 14. Quando usar agentes

A G-Rec possui agentes especializados instalados no Codex.

Use agentes por texto natural, por exemplo:

```txt
Use o code-review-senior para revisar esse projeto antes de produção.
```

Principais agentes:

- `frontend-reviewer`
- `backend-debugger`
- `supabase-specialist`
- `ui-polisher`
- `qa-tester`
- `product-strategist`
- `project-architect`
- `code-review-senior`
- `security-auditor`
- `database-architect`
- `performance-optimizer`
- `seo-conversion-specialist`
- `client-delivery-manager`
- `demo-video-scriptwriter`

Use agente quando a tarefa exigir análise especializada.

---

## 15. Quando usar skills

A G-Rec possui skills instaladas no Codex.

Use skills com barra, por exemplo:

```txt
/auditoria-final
/preparar-deploy
/corrigir-build-deploy
```

Principais skills:

- `/revisar-projeto`
- `/criar-crud-admin`
- `/preparar-deploy`
- `/gerar-readme-cliente`
- `/preparar-projeto-para-venda`
- `/transformar-prototipo-em-produto`
- `/corrigir-bug`
- `/auditoria-final`
- `/criar-saas-base`
- `/personalizar-para-cliente`
- `/gerar-proposta-comercial`
- `/corrigir-build-deploy`
- `/criar-roteiro-demo`
- `/preparar-repositorio-github`
- `/melhorar-conversao-landing`

Use skill quando a tarefa for um processo repetível.

---

## 16. Fluxo recomendado por tipo de tarefa

### Projeto novo

1. Usar `project-architect`
2. Definir stack e escopo
3. Criar estrutura
4. Implementar MVP
5. Usar `qa-tester`
6. Usar `/auditoria-final`

### Projeto quase pronto

1. Usar `/revisar-projeto`
2. Usar `code-review-senior`
3. Usar `qa-tester`
4. Usar `security-auditor` se tiver admin/login/banco
5. Usar `/preparar-deploy`

### Landing page

1. Usar `seo-conversion-specialist`
2. Usar `ui-polisher`
3. Usar `/melhorar-conversao-landing`
4. Usar `/auditoria-final`

### Erro de deploy

1. Usar `/corrigir-build-deploy`
2. Verificar logs
3. Corrigir scripts/envs
4. Rodar build local
5. Subir novamente

### Entrega para cliente

1. Usar `client-delivery-manager`
2. Usar `/gerar-readme-cliente`
3. Usar `/auditoria-final`
4. Preparar mensagem de entrega

### Prospecção e venda

1. Usar `product-strategist`
2. Usar `/preparar-projeto-para-venda`
3. Usar `/gerar-proposta-comercial`
4. Usar `demo-video-scriptwriter`

---

## 17. Formato de resposta esperado

Ao finalizar qualquer tarefa técnica, responda com:

```txt
O que foi feito
Arquivos alterados
Como testar
Pendências ou riscos
Próximo passo recomendado
```

Quando for revisão, responda com:

```txt
Status geral
Problemas encontrados
Prioridade
Arquivos afetados
Correção recomendada
Nota de 0 a 100, quando fizer sentido
```

Quando for tarefa comercial, responda com:

```txt
Resumo da solução
Público-alvo
Argumentos de venda
Valor percebido
Sugestão de preço, quando fizer sentido
Próximo passo comercial
```

---

## 18. Regras de qualidade final

Um projeto G-Rec só está pronto quando:

- Build funciona
- Mobile está aceitável
- CTAs funcionam
- Links principais funcionam
- Não há placeholders óbvios
- Admin funciona, se existir
- Login está protegido, se existir
- README existe
- `.env` não está exposto
- Deploy está configurado
- Projeto tem aparência profissional
- Cliente consegue entender o valor da entrega

---

## 19. Filosofia de implementação

Prefira:

- Código simples
- Soluções práticas
- Componentes reaproveitáveis
- Entrega funcional
- Clareza
- Segurança básica
- Boa experiência mobile
- Facilidade de manutenção

Evite:

- Overengineering
- Refatoração desnecessária
- Bibliotecas pesadas sem motivo
- Mudanças grandes sem entender o projeto
- Código bonito que não funciona
- Solução que parece premium mas quebra no uso real

---

## 20. Objetivo final

O Codex deve ajudar a G-Rec a criar projetos que possam ser:

1. Demonstrados em vídeo
2. Apresentados para clientes
3. Vendidos com clareza
4. Personalizados rapidamente
5. Entregues com profissionalismo
6. Mantidos sem dor de cabeça
