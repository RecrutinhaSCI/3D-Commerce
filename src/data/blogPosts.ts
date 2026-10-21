import type { BlogPost } from '@/types';

/**
 * Textos PADRÃO do Blog. O slug é fixo (rota pública /blog/:slug).
 *
 * Título, categoria, resumo, tempo de leitura e conteúdo podem ser editados no
 * Admin → Blog; a versão salva (site_settings.blog_content_json) sobrescreve
 * o campo correspondente daqui. Sem versão salva, vale este texto — o post
 * nunca fica vazio. Conteúdo em Markdown (GFM: tabelas, listas, links).
 *
 * Links internos usam caminhos do próprio site (/loja, /materiais, /categoria/…).
 */
export const seedBlogPosts: BlogPost[] = [
  {
    id: 'post-1',
    slug: 'guia-rapido-escolher-primeiro-filamento',
    title: 'Guia rápido para escolher seu primeiro filamento',
    excerpt:
      'PLA, PETG, ABS, ASA ou TPU? Entenda o que cada filamento faz bem, onde ele falha e qual escolher para o seu primeiro projeto.',
    cover: '',
    author: 'Equipe 3DCommerce',
    category: 'Iniciante',
    readTime: '5 min',
    createdAt: '2026-05-12',
    content: `Quem está começando na impressão 3D costuma travar na mesma dúvida: qual filamento comprar primeiro? A resposta depende menos da "qualidade" do material e mais do que você quer imprimir. Cada filamento resolve bem um tipo de problema — e cria dificuldades em outros.

Neste guia, você vai entender o comportamento real dos materiais mais usados, sem tabela de laboratório: o que cada um faz bem, onde costuma dar trabalho e em que situação vale a pena escolhê-lo.

## Antes de escolher: três perguntas

Responder estas perguntas elimina metade das opções:

1. **A peça vai ficar perto de calor?** Dentro de um carro, ao sol, perto de motor ou lâmpada.
2. **A peça vai sofrer esforço?** Encaixes, suportes, dobradiças, peças que apertam ou levam impacto.
3. **A peça vai ficar ao ar livre?** Chuva e, principalmente, raios UV degradam alguns materiais.

Se a resposta for "não" para as três, o caminho mais simples quase sempre é o PLA.

## PLA — o ponto de partida

O PLA é o filamento mais usado no mundo, e não é por acaso.

**Por que ele é fácil de imprimir**

- Imprime em temperaturas baixas (em geral entre 190 °C e 220 °C).
- Quase não empena (o famoso *warping*), então funciona bem com mesa aquecida a 50–60 °C ou até sem aquecimento em peças pequenas.
- Não exige impressora fechada e tem odor muito leve.

**Acabamento e rigidez**

O PLA entrega detalhes nítidos, cantos bem definidos e boa variedade de cores e efeitos (silk, matte, madeira, mármore). É um material **rígido**: segura bem o formato, mas quebra em vez de dobrar quando passa do limite.

**O ponto fraco: calor**

O PLA começa a amolecer por volta de 55–60 °C. Uma peça esquecida no painel do carro num dia de sol pode deformar. Ele também não é a melhor escolha para peças que sofrem impacto repetido.

**Use PLA para:** protótipos, peças decorativas, miniaturas, organizadores, maquetes, brinquedos e testes de encaixe.

**Evite PLA em:** peças expostas ao sol forte, dentro de veículos, perto de fontes de calor ou que precisam flexionar.

## PETG — o material das peças funcionais

O PETG é o próximo passo natural depois do PLA. Ele fica no meio do caminho entre a facilidade do PLA e a resistência do ABS.

**Pontos fortes**

- **Mais resistente e menos quebradiço** que o PLA: tende a flexionar um pouco antes de romper.
- **Excelente aderência entre camadas**, o que deixa as peças fortes no sentido em que o PLA costuma rachar.
- Suporta temperaturas um pouco maiores (em torno de 70–80 °C) e lida bem com umidade e vários produtos químicos.

**Onde ele dá mais trabalho**

- **Stringing:** fiapos finos entre partes da peça são comuns. Ajustar retração e temperatura resolve na maioria dos casos.
- **Gruda demais em algumas superfícies**, como vidro liso. Em placas PEI, use uma camada fina de cola bastão ou o lado texturizado.
- Dificuldade intermediária: imprime em temperaturas mais altas (230–250 °C) e pede um pouco mais de calibração.

**Use PETG para:** suportes, braçadeiras, caixas para eletrônica, peças para uso diário, recipientes, peças de reposição e projetos que ficam em área externa coberta.

## ABS — para calor e esforço

O ABS é um plástico de engenharia clássico — o mesmo tipo usado em muitas peças industriais.

**Pontos fortes**

- **Boa resistência térmica** (cerca de 95–100 °C) e mecânica.
- Aceita lixamento, colagem e acabamento com vapor de acetona, o que permite superfícies bem lisas.

**O desafio: warping**

O ABS contrai bastante ao esfriar. Sem controle, os cantos levantam da mesa e as camadas podem se separar. Para imprimir bem você vai precisar de:

- impressora **fechada** (ou um enclausuramento);
- mesa bem aquecida (em geral 90–110 °C);
- ambiente sem corrente de ar;
- **ventilação**, porque ele libera odor e partículas durante a impressão.

**Quando compensa:** peças que ficam perto de calor, dentro de veículos, carcaças, peças técnicas e projetos que vão passar por acabamento.

## ASA — o ABS feito para ficar ao ar livre

O ASA se comporta de forma parecida com o ABS na impressão, mas tem uma vantagem importante: **resistência a raios UV e às intempéries**. Peças em ABS ou PLA podem ficar quebradiças e desbotar no sol; o ASA mantém cor e propriedades por muito mais tempo.

Ele também pede impressora fechada e ventilação. Se a sua peça vai ficar exposta ao tempo — suporte de antena, peça de jardim, acessório externo —, o ASA costuma ser a escolha mais durável.

## TPU — quando a peça precisa ser flexível

O TPU é um filamento **flexível e emborrachado**. Ele resiste muito bem a impacto, abrasão e dobras repetidas.

É um material de uso específico: perfeito para capas de celular, vedações, amortecedores, pés antiderrapantes, pneus de modelos e correias. Em compensação:

- precisa ser impresso **devagar**;
- funciona melhor em extrusoras de tração direta (*direct drive*);
- é mais sensível à umidade.

Não é o melhor primeiro filamento, mas vale ter em mente quando o projeto pede elasticidade.

## Erros comuns de quem está começando

- **Escolher o material "mais forte" para tudo.** ABS em uma peça decorativa só adiciona dificuldade.
- **Ignorar a umidade.** PETG, TPU e até PLA absorvem umidade do ar; filamento úmido estala, solta bolhas e deixa a peça frágil. Guarde em embalagem fechada com sílica.
- **Copiar configurações de outro material.** Cada filamento tem sua faixa de temperatura e velocidade; comece pelo que o fabricante recomenda.
- **Não testar antes.** Uma torre de temperatura e um teste de retração economizam horas e material.

## Decisão rápida

| Se a sua situação é… | Comece com |
| --- | --- |
| Estou começando / peça decorativa | **PLA** |
| Peça funcional, que sofre esforço | **PETG** |
| Peça perto de calor | **ABS** |
| Uso externo, sol e chuva | **ASA** |
| Peça flexível ou que absorve impacto | **TPU** |

Na dúvida, comece pelo PLA: ele permite aprender a calibrar a impressora sem brigar com o material. Depois que as primeiras peças saírem bem, migrar para PETG é o passo mais natural.

---

Quer comparar os materiais com mais calma? Veja o [guia de materiais](/materiais) ou confira os [filamentos disponíveis na loja](/loja?grupo=filamentos).`,
  },
  {
    id: 'post-2',
    slug: 'pla-petg-abs-diferencas',
    title: 'Diferença entre PLA, PETG e ABS na prática',
    excerpt:
      'Tabela comparativa e exemplos reais: qual dos três filamentos mais usados resolve melhor cada tipo de peça.',
    cover: '',
    author: 'Equipe 3DCommerce',
    category: 'Materiais',
    readTime: '4 min',
    createdAt: '2026-05-20',
    content: `PLA, PETG e ABS respondem pela maior parte do que é impresso em impressoras FDM. Os três funcionam muito bem — desde que usados no lugar certo. Escolher errado costuma gerar dois tipos de frustração: peça que não aguenta o uso, ou impressão que dá muito trabalho sem necessidade.

Este comparativo foca no que muda **na prática**: como cada um se comporta na impressora e depois que a peça está pronta.

## Comparativo direto

| Característica | PLA | PETG | ABS |
| --- | --- | --- | --- |
| Facilidade de impressão | Muito fácil | Intermediária | Exige mais controle |
| Rigidez | Alta | Média | Média |
| Resistência mecânica | Boa, porém quebradiço | Muito boa | Muito boa |
| Resistência ao impacto | Baixa | Boa | Boa |
| Resistência térmica | ~55–60 °C | ~70–80 °C | ~95–100 °C |
| Acabamento | Excelente, detalhes nítidos | Brilhante, mais "plástico" | Fosco, aceita lixa e acetona |
| Warping (empenamento) | Mínimo | Baixo | Alto |
| Uso externo | Ruim | Razoável (área coberta) | Ruim sem proteção UV |
| Dificuldade geral | Iniciante | Intermediário | Intermediário/avançado |
| Aplicações típicas | Protótipos, decoração, maquetes | Peças funcionais, suportes, caixas | Peças técnicas, peças perto de calor |

*Os valores de temperatura são aproximados e variam entre fabricantes e formulações.*

## O que essas diferenças significam

### Facilidade de impressão

O **PLA** perdoa muitos erros: imprime frio, quase não empena e não pede impressora fechada. O **PETG** precisa de temperaturas mais altas e de ajuste de retração para evitar fiapos. O **ABS** contrai ao esfriar, então depende de mesa quente, ambiente fechado e estável — e de ventilação, por causa do odor.

### Rigidez x resistência

Rigidez é segurar a forma; resistência é aguentar esforço sem quebrar. O PLA é rígido, mas quebradiço: sob carga, ele trinca de repente. PETG e ABS cedem um pouco antes de romper, o que os torna mais confiáveis em encaixes, presilhas e peças que levam batidas.

### Calor

É a diferença mais importante e a mais ignorada. Uma peça de PLA dentro de um carro estacionado ao sol pode deformar em poucas horas. O PETG aguenta um pouco mais; o ABS é o mais indicado entre os três quando a temperatura sobe.

### Acabamento

O PLA reproduz detalhes finos com facilidade e tem a maior variedade de cores e efeitos. O PETG fica brilhante e levemente translúcido em algumas cores. O ABS tem aspecto fosco e é o melhor dos três para **pós-processamento**: lixa, cola e alisamento com vapor de acetona.

### Uso externo

Nenhum dos três é ideal para sol direto por longos períodos. O PETG se sai melhor que o PLA em ambiente úmido ou coberto. Para exposição real ao tempo, a alternativa certa é o **ASA**, um material parecido com o ABS e com proteção contra UV.

## Situações reais

### Peça decorativa

Vaso, luminária, troféu, miniatura ou peça de exposição: **PLA**. Você ganha acabamento, variedade de cores e impressão sem dor de cabeça. Não há esforço nem calor envolvidos.

### Suporte mecânico

Suporte de prateleira, braçadeira, gancho, presilha: **PETG**. Ele aguenta carga e pequenas flexões sem rachar entre as camadas. O PLA até funciona em peças robustas, mas tende a quebrar de forma súbita quando sobrecarregado.

### Peça perto de calor

Suporte próximo a motor, peça de painel de carro, carcaça de equipamento que esquenta: **ABS** (ou ASA, se também houver sol). Aqui o PLA é a escolha errada, mesmo que imprima bem.

### Protótipo

Para validar formato, tamanho e encaixe, **PLA**: é barato, rápido e fiel ao desenho. Se o protótipo precisa ser testado em uso real — abrir, fechar, aguentar peso —, imprima a versão final em PETG.

### Peça para uso externo

Peças de jardim, suportes de antena e acessórios externos: **ASA** é o mais indicado. Em área externa coberta, o PETG costuma dar conta. Evite PLA, que fica quebradiço com o tempo ao sol.

### Peça que precisa durar

Para itens de uso diário, que vão ser manuseados por anos, **PETG** é o melhor equilíbrio entre resistência e facilidade de impressão. Se a peça também enfrenta calor, vá de ABS.

## Erros comuns na escolha

- **Usar PLA em tudo porque "imprime bem".** Ótimo para começar, mas não para peças funcionais expostas a calor.
- **Ir direto para ABS sem impressora fechada.** O resultado costuma ser peça empenada e camadas separando.
- **Desistir do PETG por causa de fiapos.** Na maioria das vezes, ajustar retração e baixar alguns graus resolve.
- **Esquecer a umidade.** Os três absorvem umidade; o PETG é o mais sensível. Filamento seco imprime melhor.

## Recomendação por cenário

- **Começando ou peça decorativa:** PLA.
- **Peça funcional do dia a dia:** PETG.
- **Calor e esforço:** ABS (com impressora fechada).
- **Sol e chuva:** ASA.

Se você ainda está montando sua base de materiais, ter **PLA para protótipos** e **PETG para peças finais** cobre a grande maioria dos projetos.

---

Veja os filamentos disponíveis: [PLA](/categoria/filamentos-pla), [PETG](/categoria/filamentos-petg) e [ABS](/categoria/filamentos-abs) — ou compare todos os materiais no [guia de materiais](/materiais).`,
  },
  {
    id: 'post-3',
    slug: 'como-escolher-primeira-impressora-3d',
    title: 'Como escolher sua primeira impressora 3D',
    excerpt:
      'FDM ou resina, volume, velocidade, calibração, manutenção e custo de uso: o que realmente importa antes de comprar.',
    cover: '',
    author: 'Equipe 3DCommerce',
    category: 'Equipamentos',
    readTime: '5 min',
    createdAt: '2026-06-02',
    content: `Comprar a primeira impressora 3D é empolgante — e fácil de errar. As fichas técnicas são parecidas, os números de velocidade impressionam e cada modelo promete ser o mais fácil do mercado. Este guia ajuda a separar o que importa de verdade do que é só detalhe, para você escolher pelo seu uso e não pelo anúncio.

## Primeiro: FDM ou resina?

Existem duas tecnologias principais para uso pessoal e profissional.

### FDM/FFF (filamento)

A impressora derrete um filamento plástico e deposita camada por camada. É a tecnologia mais comum e versátil.

- Imprime peças **funcionais e resistentes** (PLA, PETG, ABS, ASA, TPU…).
- Permite peças grandes com custo baixo por peça.
- Pós-processamento simples: remover suportes e, se quiser, lixar.

### Resina (SLA/MSLA)

A impressora endurece resina líquida com luz UV, camada por camada.

- Entrega **detalhes muito finos** e superfície lisa.
- Ideal para miniaturas, joias e modelos odontológicos.
- Exige lavagem, cura UV, luvas e ventilação.

**Para a maioria das pessoas, a primeira impressora deve ser FDM.** Ela atende mais projetos, tem materiais mais baratos e um processo mais simples. Resina faz sentido quando o foco é detalhe extremo — falamos disso em [quando usar resina na impressão 3D](/blog/quando-usar-resina-impressao-3d).

## O que avaliar numa impressora FDM

### Volume de impressão

É o tamanho máximo da peça. Algo em torno de 22 × 22 × 22 cm atende a maior parte dos projetos. Volume maior é útil para peças grandes e para imprimir várias peças de uma vez, mas aumenta o preço e o espaço ocupado.

### Velocidade (com ressalvas)

Impressoras modernas imprimem muito mais rápido que as de alguns anos atrás. Mas velocidade anunciada não é tudo: o que conta é **imprimir rápido com qualidade**, o que depende de estrutura rígida, compensação de vibração e bom resfriamento.

### Facilidade de uso e calibração

Este é o ponto que mais muda a experiência de quem está começando:

- **Nivelamento automático da mesa** elimina o ajuste manual com papel — uma das maiores fontes de falha.
- **Calibração automática** de vibração e fluxo poupa horas de testes.
- Interface clara, Wi‑Fi e câmera ajudam a acompanhar impressões longas.

### Impressora aberta ou fechada

Modelos abertos são mais baratos e atendem bem PLA, PETG e TPU. Modelos **fechados** mantêm a temperatura estável e são necessários para imprimir bem ABS e ASA, além de reduzir ruído e odor.

### Peças de reposição e manutenção

Bicos, mesas e correias se desgastam com o uso. Antes de comprar, verifique:

- se há **peças de reposição** disponíveis no Brasil;
- se a troca de bico é simples;
- se existe assistência ou suporte técnico acessível.

### Comunidade e ecossistema

Uma marca com comunidade grande significa tutoriais, perfis prontos de impressão e respostas rápidas para problemas comuns. Ecossistemas integrados — impressora, slicer, aplicativo e acessórios da mesma marca — reduzem atrito no dia a dia. A **Bambu Lab**, por exemplo, ficou conhecida por esse tipo de integração, mas outras marcas também oferecem boas soluções; o importante é o conjunto funcionar bem.

### Software (slicer)

O slicer transforma o modelo 3D nas instruções da impressora. Prefira impressoras compatíveis com slicers conhecidos e atualizados, que tragam perfis prontos para os principais filamentos.

### Custo de uso

O preço da impressora é só o começo. Considere também:

- custo do **filamento** que você vai usar;
- consumo de bicos e mesas;
- energia em impressões longas;
- se a impressora aceita filamentos de qualquer marca.

### Ruído e espaço físico

Impressoras rápidas fazem barulho, principalmente ventoinhas. Pense onde ela vai ficar: escritório, quarto ou oficina. Deixe espaço ao redor para ventilação e acesso à mesa e ao filamento.

## Qual perfil é o seu?

| Perfil | O que priorizar |
| --- | --- |
| **Iniciante** | Nivelamento e calibração automáticos, interface simples, bons perfis prontos |
| **Hobby** | Volume médio, boa qualidade em PLA/PETG, comunidade ativa |
| **Profissional** | Confiabilidade, impressora fechada, materiais técnicos, suporte |
| **Produção** | Velocidade com qualidade, baixo índice de falhas, manutenção simples, várias unidades |

## Por que uma impressora mais cara pode sair mais barata

Uma impressora barata que exige ajustes constantes custa caro em **tempo e material desperdiçado**. Cada falha no meio de uma impressão de oito horas é filamento jogado fora e um dia perdido.

Modelos com calibração automática, estrutura rígida e boa detecção de falhas costumam:

- errar menos (menos material perdido);
- exigir menos tempo de ajuste;
- produzir mais peças por dia, o que importa muito para quem vende.

Para quem imprime com frequência ou quer gerar renda, o investimento maior costuma se pagar em produtividade.

## Erros comuns na compra

- **Escolher só pelo preço.** O barato pode virar uma impressora parada esperando ajuste.
- **Comprar a maior impressora possível sem precisar.** Ocupa espaço e custa mais sem trazer benefício para peças pequenas.
- **Ignorar materiais.** Se você precisa de ABS ou ASA, a impressora fechada faz diferença.
- **Não pensar em reposição.** Verifique se há peças e suporte antes de decidir.

## Recomendação final

Para a maioria dos iniciantes, uma **impressora FDM com nivelamento e calibração automáticos**, volume médio e boa comunidade é o melhor ponto de partida. Se você pretende imprimir materiais técnicos ou trabalhar com produção, considere um modelo fechado desde o início.

---

Veja as [impressoras 3D disponíveis](/categoria/impressoras-3d) ou [fale com a gente](/contato) para receber uma indicação de acordo com o seu uso.`,
  },
  {
    id: 'post-4',
    slug: 'quando-usar-resina-impressao-3d',
    title: 'Quando usar resina na impressão 3D',
    excerpt:
      'Detalhe extremo e superfície lisa, mas com cuidados de segurança: quando a impressão em resina vale a pena e quando o FDM resolve melhor.',
    cover: '',
    author: 'Equipe 3DCommerce',
    category: 'Materiais',
    readTime: '4 min',
    createdAt: '2026-06-15',
    content: `A impressão em resina é conhecida pelo nível de detalhe impressionante — e também por exigir um processo mais cuidadoso. Ela não substitui a impressão com filamento: as duas tecnologias resolvem problemas diferentes. Entender essa diferença evita comprar o equipamento errado ou usar a resina onde ela não faz sentido.

## Como funciona a impressão em resina

Em vez de derreter um filamento, a impressora usa **resina líquida fotossensível**, que endurece quando recebe luz ultravioleta.

- Na tecnologia **SLA**, um laser desenha cada camada.
- Na **MSLA**, mais comum hoje, uma tela LCD projeta a camada inteira de uma vez.

Em ambos os casos, a peça é formada camada por camada, normalmente "de cabeça para baixo", presa a uma plataforma que sobe do tanque de resina. As camadas são muito finas, e é daí que vem o nível de detalhe.

## Quando a resina faz sentido

A resina brilha quando o detalhe e a superfície importam mais que o tamanho ou a resistência mecânica:

- **Miniaturas** de jogos e colecionáveis, com rostos, texturas e detalhes pequenos.
- **Joias e moldes**, incluindo resinas próprias para fundição.
- **Modelos odontológicos** e aplicações da área da saúde (com resinas específicas e certificadas para cada uso).
- **Peças extremamente detalhadas**, como componentes de maquetes e réplicas.
- **Protótipos visuais**, quando a aparência final precisa ser fiel para apresentação.

## Vantagens

- **Detalhe:** reproduz elementos minúsculos que o FDM não alcança.
- **Superfície lisa:** as linhas de camada são praticamente invisíveis.
- **Precisão visual:** ótima fidelidade de formas e cantos.

## Desvantagens e cuidados

A resina exige mais atenção — principalmente com segurança.

- **Resina líquida exige cuidado:** ela pode irritar a pele e as vias respiratórias. Use sempre **luvas nitrílicas** e evite contato direto.
- **Ventilação:** trabalhe em ambiente arejado. A resina libera odor e vapores durante a impressão e a lavagem.
- **Lavagem:** depois de impressa, a peça precisa ser lavada (normalmente em álcool isopropílico ou com resinas laváveis em água) para remover o excesso.
- **Cura UV:** a peça só atinge a resistência final depois de curada com luz ultravioleta.
- **Descarte adequado:** resina líquida e o álcool contaminado **não podem ir para o ralo**. Deixe curar ao sol ou sob luz UV antes de descartar e siga as orientações do fabricante.
- **Tamanho e custo:** o volume de impressão costuma ser menor e o custo por peça, maior.
- **Peças mais frágeis:** muitas resinas padrão são quebradiças. Existem resinas resistentes e flexíveis, mas para peças mecânicas o FDM geralmente é melhor.

## Resina x FDM

| Critério | Resina (SLA/MSLA) | FDM (filamento) |
| --- | --- | --- |
| Nível de detalhe | Muito alto | Bom |
| Acabamento da superfície | Liso, quase sem linhas | Linhas de camada visíveis |
| Resistência mecânica | Baixa a média (depende da resina) | Média a alta |
| Tamanho das peças | Pequeno a médio | Pequeno a grande |
| Custo por peça | Maior | Menor |
| Pós-processamento | Lavagem + cura UV | Remover suportes |
| Segurança | Luvas, ventilação e descarte correto | Ventilação em alguns materiais |
| Melhor para | Miniaturas, joias, odontologia, protótipos visuais | Peças funcionais, protótipos, uso geral |

## Resina não é "melhor" — é diferente

É comum pensar que a resina é uma evolução do FDM. Não é. Ela é superior em **detalhe e acabamento**, mas perde em **resistência, tamanho e simplicidade**. Uma presilha, um suporte ou uma caixa para eletrônica ficam melhores em PETG; uma miniatura de 3 cm com expressão facial fica melhor em resina.

Muitos usuários acabam tendo as duas tecnologias, cada uma para o seu tipo de trabalho.

## Erros comuns de quem começa na resina

- **Imprimir sem luvas ou em ambiente fechado.** O cuidado com segurança deve ser rotina desde a primeira impressão.
- **Pular a lavagem ou curar demais.** Peça mal lavada fica pegajosa; cura excessiva deixa a peça quebradiça.
- **Descartar resina no ralo.** Sempre cure antes de descartar.
- **Escolher resina para peças funcionais.** Se a peça precisa aguentar esforço, avalie primeiro o FDM.

## Recomendação final

Escolha a resina se o seu trabalho depende de **detalhe fino e acabamento perfeito** — miniaturas, joias, odontologia ou protótipos de apresentação — e se você tem um espaço ventilado para trabalhar com segurança. Para peças funcionais e uso geral, a impressão com filamento continua sendo a escolha mais prática.

---

Ainda em dúvida sobre qual tecnologia atende o seu projeto? Compare os materiais no [guia de materiais](/materiais) ou [solicite um orçamento](/orcamento) para a sua peça.`,
  },
];
