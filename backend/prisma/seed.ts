/**
 * Seed inicial do 3D Commerce.
 *
 * Idempotente: pode ser executado várias vezes sem duplicar dados.
 * Usa `upsert` em todos os registros base.
 *
 *   npm run prisma:seed
 */
import { PrismaClient, ProductPurchaseMode, UserRole, CouponDiscountType, ScriptCategory } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@3dcommerce.com';
const ADMIN_PASSWORD = 'admin123';

async function main() {
  console.log('[seed] iniciando...');

  // -----------------------------------------------------------------------
  // 1. Admin
  // -----------------------------------------------------------------------
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: {
      name: '3DCommerce Admin',
      email: ADMIN_EMAIL,
      passwordHash,
      phone: '5554992752253',
      role: UserRole.ADMIN,
      active: true,
    },
    update: {
      // Mantém o hash atualizado se a senha for alterada acima.
      passwordHash,
      role: UserRole.ADMIN,
      active: true,
    },
  });
  console.log(`[seed] admin: ${admin.email}`);

  // -----------------------------------------------------------------------
  // 2. Categorias
  // -----------------------------------------------------------------------
  const categoriesData = [
    { slug: 'filamentos-pla', name: 'Filamentos PLA', description: 'PLA 1.75mm das melhores marcas.' },
    { slug: 'filamentos-petg', name: 'Filamentos PETG', description: 'Resistência mecânica e bom acabamento.' },
    { slug: 'resinas', name: 'Resinas', description: 'Resinas para impressoras LCD/SLA.' },
    { slug: 'impressoras-3d', name: 'Impressoras 3D', description: 'FDM e Resina das marcas líderes.' },
    { slug: 'acessorios', name: 'Acessórios', description: 'Bicos, mesas, kits de limpeza e mais.' },
    { slug: 'produtos-prontos', name: 'Produtos Prontos', description: 'Peças impressas em 3D.' },
    { slug: 'ofertas', name: 'Ofertas', description: 'Produtos selecionados com desconto.' },
  ];

  const categoriesBySlug: Record<string, string> = {};
  for (const c of categoriesData) {
    const cat = await prisma.category.upsert({
      where: { slug: c.slug },
      create: c,
      update: { name: c.name, description: c.description },
    });
    categoriesBySlug[cat.slug] = cat.id;
  }

  // Categoria sazonal
  const seasonal = await prisma.category.upsert({
    where: { slug: 'copa-do-mundo' },
    create: {
      slug: 'copa-do-mundo',
      name: 'Copa do Mundo',
      description: 'Edição especial Copa do Mundo — chaveiros e itens temáticos.',
      isSeasonal: true,
      seasonalTitle: 'Copa do Mundo 3D',
      seasonalDescription: 'Chaveiros, troféus e itens temáticos personalizados.',
    },
    update: {
      isSeasonal: true,
      seasonalTitle: 'Copa do Mundo 3D',
    },
  });
  categoriesBySlug[seasonal.slug] = seasonal.id;

  console.log(`[seed] categorias: ${Object.keys(categoriesBySlug).length}`);

  // -----------------------------------------------------------------------
  // 3. Produtos
  // -----------------------------------------------------------------------
  const productsData: Array<{
    slug: string;
    name: string;
    categorySlug: string;
    price: number;
    promotionalPrice?: number;
    stock: number;
    sku: string;
    material?: string;
    color?: string;
    shortDescription: string;
    description: string;
    featured?: boolean;
    purchaseMode?: ProductPurchaseMode;
    imageUrl: string;
  }> = [
    {
      slug: 'filamento-pla-preto-1kg',
      name: 'Filamento PLA Preto 1kg',
      categorySlug: 'filamentos-pla',
      price: 129.9,
      promotionalPrice: 109.9,
      stock: 32,
      sku: 'PLA-PRETO-1KG',
      material: 'PLA',
      color: 'Preto',
      shortDescription: 'PLA 1.75mm de alta qualidade, ideal para iniciantes.',
      description:
        'Filamento PLA 1.75mm em cor preta. Baixa contração, fácil impressão, excelente acabamento.',
      featured: true,
      purchaseMode: ProductPurchaseMode.DIRECT,
      imageUrl: '/uploads/seed/pla-preto.svg',
    },
    {
      slug: 'filamento-pla-branco-1kg',
      name: 'Filamento PLA Branco 1kg',
      categorySlug: 'filamentos-pla',
      price: 129.9,
      stock: 28,
      sku: 'PLA-BRANCO-1KG',
      material: 'PLA',
      color: 'Branco',
      shortDescription: 'PLA branco perfeito para projetos limpos e modernos.',
      description: 'PLA 1.75mm em cor branca. Excelente para protótipos e peças decorativas.',
      featured: true,
      imageUrl: '/uploads/seed/pla-branco.svg',
    },
    {
      slug: 'filamento-petg-transparente-1kg',
      name: 'Filamento PETG Transparente 1kg',
      categorySlug: 'filamentos-petg',
      price: 159.9,
      promotionalPrice: 139.9,
      stock: 12,
      sku: 'PETG-TRANS-1KG',
      material: 'PETG',
      color: 'Transparente',
      shortDescription: 'Resistente, brilhante e translúcido.',
      description: 'PETG transparente 1.75mm, 1kg. Excelente para peças funcionais.',
      featured: true,
      imageUrl: '/uploads/seed/petg-trans.svg',
    },
    {
      slug: 'resina-standard-cinza-1kg',
      name: 'Resina Standard Cinza 1kg',
      categorySlug: 'resinas',
      price: 219.9,
      promotionalPrice: 189.9,
      stock: 11,
      sku: 'RESIN-STD-CINZA',
      material: 'Resina',
      color: 'Cinza',
      shortDescription: 'Resina padrão de alta resolução.',
      description: 'Resina cinza padrão, 1kg, ideal para impressoras LCD/SLA.',
      featured: true,
      imageUrl: '/uploads/seed/resina-cinza.svg',
    },
    {
      slug: 'impressora-3d-creality-ender-3-v3',
      name: 'Impressora 3D Creality Ender 3 V3',
      categorySlug: 'impressoras-3d',
      price: 2199,
      promotionalPrice: 1899,
      stock: 4,
      sku: 'CREALITY-ENDER3V3',
      shortDescription: 'Impressora FDM popular para iniciantes e makers.',
      description:
        'Creality Ender 3 V3, área 220x220x250mm, nivelamento automático. Suporte técnico incluso.',
      featured: true,
      purchaseMode: ProductPurchaseMode.BOTH,
      imageUrl: '/uploads/seed/ender3v3.svg',
    },
    {
      slug: 'impressora-3d-bambu-lab-a1',
      name: 'Impressora 3D Bambu Lab A1',
      categorySlug: 'impressoras-3d',
      price: 4990,
      stock: 2,
      sku: 'BAMBU-A1',
      shortDescription: 'Velocidade e qualidade de fábrica em casa.',
      description: 'Bambu Lab A1: velocidade altíssima, calibração automática.',
      featured: true,
      purchaseMode: ProductPurchaseMode.QUOTE,
      imageUrl: '/uploads/seed/bambu-a1.svg',
    },
    {
      slug: 'bico-nozzle-04mm',
      name: 'Bico Nozzle 0.4mm',
      categorySlug: 'acessorios',
      price: 19.9,
      stock: 120,
      sku: 'NOZZLE-04',
      shortDescription: 'Bico padrão de reposição para impressoras FDM.',
      description: 'Nozzle 0.4mm em latão, compatível com Ender, Bambu Lab e similares.',
      imageUrl: '/uploads/seed/nozzle.svg',
    },
    {
      slug: 'mesa-magnetica-pei-235',
      name: 'Mesa Magnética PEI 235x235mm',
      categorySlug: 'acessorios',
      price: 169.9,
      stock: 20,
      sku: 'MESA-PEI-235',
      shortDescription: 'Adesão perfeita e remoção fácil.',
      description: 'Mesa magnética com superfície PEI texturizada 235x235mm.',
      imageUrl: '/uploads/seed/mesa-pei.svg',
    },
    {
      slug: 'kit-limpeza-impressora-3d',
      name: 'Kit Limpeza Impressora 3D',
      categorySlug: 'acessorios',
      price: 79.9,
      promotionalPrice: 59.9,
      stock: 35,
      sku: 'KIT-LIMPEZA',
      shortDescription: 'Tudo para manutenção da sua impressora.',
      description: 'Kit com pinças, agulhas para nozzle, espátula e escova.',
      imageUrl: '/uploads/seed/kit-limpeza.svg',
    },
    {
      slug: 'chaveiro-3d-personalizado',
      name: 'Chaveiro 3D Personalizado',
      categorySlug: 'produtos-prontos',
      price: 24.9,
      stock: 999,
      sku: 'CHAVEIRO-3D',
      shortDescription: 'Chaveiro impresso em 3D com seu nome ou tema.',
      description: 'Chaveiro personalizável com nome, logo ou tema.',
      purchaseMode: ProductPurchaseMode.QUOTE,
      imageUrl: '/uploads/seed/chaveiro.svg',
    },
  ];

  for (const p of productsData) {
    const categoryId = categoriesBySlug[p.categorySlug];
    if (!categoryId) throw new Error(`Categoria não encontrada para slug ${p.categorySlug}`);
    await prisma.product.upsert({
      where: { slug: p.slug },
      create: {
        categoryId,
        name: p.name,
        slug: p.slug,
        sku: p.sku,
        price: p.price,
        promotionalPrice: p.promotionalPrice,
        stock: p.stock,
        material: p.material,
        color: p.color,
        shortDescription: p.shortDescription,
        description: p.description,
        featured: !!p.featured,
        purchaseMode: p.purchaseMode ?? ProductPurchaseMode.DIRECT,
        images: { create: [{ url: p.imageUrl, alt: p.name, position: 0 }] },
      },
      update: {
        name: p.name,
        price: p.price,
        promotionalPrice: p.promotionalPrice ?? null,
        stock: p.stock,
        shortDescription: p.shortDescription,
        description: p.description,
        featured: !!p.featured,
        purchaseMode: p.purchaseMode ?? ProductPurchaseMode.DIRECT,
      },
    });
  }
  console.log(`[seed] produtos: ${productsData.length}`);

  // -----------------------------------------------------------------------
  // 4. SiteSettings (registro único — id "main")
  // -----------------------------------------------------------------------
  await prisma.siteSettings.upsert({
    where: { id: 'main' },
    create: {
      id: 'main',
      storeName: '3DCommerce',
      whatsapp: '5554992752253',
      email: 'commerce3d@outlook.com',
      instagram: 'https://www.instagram.com/3dcommerce_bg/',
      // Endereço textual da loja física. Só aplicado na primeira criação do
      // registro — upsert não sobrescreve o valor já cadastrado pelo admin.
      address:
        "L'América Shopping Center — Rua 13 de Maio, 877, São Bento, Bento Gonçalves/RS",
      cnpj: '66.771.571/0001-38',
      heroTitle: 'Tudo para impressão 3D em um só lugar',
      heroSubtitle:
        'Filamentos, resinas, impressoras e suporte especializado. Envio para todo o Brasil.',
      aboutTitle: 'Sobre a 3DCommerce',
      aboutText:
        'A 3DCommerce é especializada em soluções completas de impressão 3D. Loja física em Bento Gonçalves/RS e envio para todo o Brasil.',
      seoTitle: '3DCommerce — Tudo para impressão 3D',
      seoDescription:
        'Filamentos, resinas, impressoras 3D e acessórios com suporte especializado. Loja física em Bento Gonçalves/RS.',
      pixDiscountPercent: 5,
      freeShippingThreshold: 299,
      shippingNote: 'Enviamos para todo o Brasil',
    },
    update: {
      storeName: '3DCommerce',
      whatsapp: '5554992752253',
      email: 'commerce3d@outlook.com',
    },
  });
  console.log('[seed] siteSettings: ok');

  // -----------------------------------------------------------------------
  // 5. Banners
  // -----------------------------------------------------------------------
  const bannersData = [
    {
      id: 'banner-hero-default',
      title: 'Tudo para impressão 3D em um só lugar',
      subtitle: 'Filamentos, resinas, impressoras e suporte especializado.',
      buttonText: 'Ver loja',
      buttonLink: '/loja',
      position: 1,
    },
    {
      id: 'banner-filamentos-default',
      title: 'Filamentos selecionados a partir de R$ 109,90',
      subtitle: 'PLA, PETG e ABS das melhores marcas.',
      buttonText: 'Ver filamentos',
      buttonLink: '/categoria/filamentos-pla',
      position: 2,
    },
  ];
  for (const b of bannersData) {
    await prisma.banner.upsert({
      where: { id: b.id },
      create: b,
      update: { title: b.title, subtitle: b.subtitle },
    });
  }
  console.log(`[seed] banners: ${bannersData.length}`);

  // -----------------------------------------------------------------------
  // 6. Testimonials
  // -----------------------------------------------------------------------
  const testimonialsData = [
    {
      id: 'testimonial-1',
      name: 'Carlos Pereira',
      role: 'Maker em Bento Gonçalves',
      content:
        'Comprei meu primeiro filamento na 3DCommerce e o atendimento foi impecável. Recomendo demais!',
      rating: 5,
    },
    {
      id: 'testimonial-2',
      name: 'Mariana Souza',
      role: 'Estúdio de design',
      content:
        'Encomenda chegou rápido em São Paulo e a equipe ainda me ajudou a escolher a resina certa para meu projeto.',
      rating: 5,
    },
  ];
  for (const t of testimonialsData) {
    await prisma.testimonial.upsert({
      where: { id: t.id },
      create: t,
      update: { content: t.content, rating: t.rating },
    });
  }
  console.log(`[seed] testimonials: ${testimonialsData.length}`);

  // -----------------------------------------------------------------------
  // 7. Cupons de exemplo (R12) — idempotente por code.
  // -----------------------------------------------------------------------
  const now = new Date();
  const in30days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const couponsData = [
    {
      code: 'BLACK10',
      name: 'Black Friday 10% OFF',
      description: 'Desconto de 10% em toda a loja.',
      discountType: CouponDiscountType.PERCENTAGE,
      discountValue: 10,
      expiresAt: in30days,
      isActive: true,
    },
    {
      code: 'PRIMEIRACOMPRA',
      name: 'Primeira Compra R$ 20 OFF',
      description: 'R$ 20 de desconto em pedidos acima de R$ 150.',
      discountType: CouponDiscountType.FIXED_AMOUNT,
      discountValue: 20,
      minOrderValue: 150,
      isActive: true,
    },
    {
      code: 'FRETEGRATIS',
      name: 'Frete Grátis',
      description: 'Frete grátis em qualquer pedido.',
      discountType: CouponDiscountType.FREE_SHIPPING,
      discountValue: 0,
      isActive: true,
    },
    {
      code: 'NATAL3D',
      name: 'Natal 3D 15% OFF',
      description: 'Cupom sazonal de Natal.',
      discountType: CouponDiscountType.PERCENTAGE,
      discountValue: 15,
      isSeasonal: true,
      seasonalName: 'Natal',
      isActive: true,
    },
    {
      code: 'VIP5',
      name: 'VIP 5 usos',
      description: 'Válido apenas para os 5 primeiros usos.',
      discountType: CouponDiscountType.PERCENTAGE,
      discountValue: 12,
      usageLimit: 5,
      isActive: true,
    },
  ] as const;

  const couponsByCode: Record<string, string> = {};
  for (const c of couponsData) {
    const saved = await prisma.coupon.upsert({
      where: { code: c.code },
      create: {
        code: c.code,
        name: c.name,
        description: c.description,
        discountType: c.discountType,
        discountValue: c.discountValue,
        minOrderValue: 'minOrderValue' in c ? c.minOrderValue : null,
        expiresAt: 'expiresAt' in c ? c.expiresAt : null,
        usageLimit: 'usageLimit' in c ? c.usageLimit : null,
        isSeasonal: 'isSeasonal' in c ? c.isSeasonal : false,
        seasonalName: 'seasonalName' in c ? c.seasonalName : null,
        isActive: c.isActive,
      },
      update: { name: c.name, description: c.description },
    });
    couponsByCode[c.code] = saved.id;
  }
  console.log(`[seed] cupons: ${couponsData.length}`);

  // -----------------------------------------------------------------------
  // 8. Scripts de WhatsApp de exemplo (R12) — idempotente por id fixo.
  // -----------------------------------------------------------------------
  const scriptsData = [
    {
      id: 'script-cupom-boasvindas',
      title: 'Oferta com cupom',
      description: 'Envie um cupom de desconto para o cliente.',
      category: ScriptCategory.COUPON,
      linkedCouponCode: 'BLACK10',
      messageTemplate:
        'Olá, {{nome_cliente}}! Tudo bem? 😊\n\nTemos uma condição especial para você na {{nome_loja}}:\n\nUse o cupom *{{cupom}}* e ganhe {{desconto}} na sua compra.\nVálido até {{validade}}.\n\nAcesse: {{link_loja}}\n\nQualquer dúvida, me chama por aqui!',
    },
    {
      id: 'script-pos-venda',
      title: 'Pós-venda / agradecimento',
      description: 'Mensagem de agradecimento após a compra.',
      category: ScriptCategory.POST_SALE,
      linkedCouponCode: null,
      messageTemplate:
        'Oi, {{nome_cliente}}! Aqui é da {{nome_loja}}. 🙌\n\nObrigado pela sua compra! Qualquer dúvida sobre o seu pedido, é só me chamar por aqui.',
    },
    {
      id: 'script-recuperacao-orcamento',
      title: 'Recuperação de orçamento',
      description: 'Retomar contato com quem pediu orçamento.',
      category: ScriptCategory.QUOTE_RECOVERY,
      linkedCouponCode: 'PRIMEIRACOMPRA',
      messageTemplate:
        'Olá, {{nome_cliente}}! Vi que você pediu um orçamento na {{nome_loja}}.\n\nAinda dá tempo de fechar com condição especial: use o cupom *{{cupom}}* e ganhe {{desconto}}.\n\nMe chama para finalizar! {{link_loja}}',
    },
  ] as const;

  for (const s of scriptsData) {
    const linkedCouponId = s.linkedCouponCode ? couponsByCode[s.linkedCouponCode] ?? null : null;
    await prisma.couponScript.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        title: s.title,
        description: s.description,
        category: s.category,
        messageTemplate: s.messageTemplate,
        linkedCouponId,
        isActive: true,
      },
      update: { title: s.title, messageTemplate: s.messageTemplate, linkedCouponId },
    });
  }
  console.log(`[seed] scripts: ${scriptsData.length}`);

  console.log('[seed] finalizado com sucesso.');
}

main()
  .catch((err) => {
    console.error('[seed] erro:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
