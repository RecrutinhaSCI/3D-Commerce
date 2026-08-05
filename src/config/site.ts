export const site = {
  name: '3DCommerce',
  tagline: 'Tudo para impressão 3D em um só lugar',
  whatsapp: '5554992752253',
  whatsappDisplay: '(54) 99275-2253',
  email: 'commerce3d@outlook.com',
  instagram: 'https://www.instagram.com/3dcommerce_bg/',
  instagramHandle: '@3dcommerce_bg',
  // Endereço textual — fallback do frontend enquanto `SiteSettings.address`
  // (editável no admin) ainda não carregou. Reflete a localização real da loja
  // física, para bater com o marcador do mapa incorporado.
  address: "L'América Shopping Center — Rua 13 de Maio, 877, São Bento, Bento Gonçalves/RS",
  // Link EXTERNO canônico do Google Maps (R20). Usado apenas em âncoras que
  // redirecionam o usuário para fora do site (topbar/footer/botões "Abrir no
  // Google Maps"/ícones de localização).
  mapsUrl: 'https://maps.app.goo.gl/gYqaj3taprHTKbUy5',
  // URL EXCLUSIVA do iframe de embed. NUNCA derivada do shortlink acima —
  // colocar `maps.app.goo.gl/...` no `?q=` faz o iframe renderizar um
  // mapa-múndi porque o Google Maps não resolve shortlinks dentro do embed.
  // Aqui usamos a busca textual pelo estabelecimento, que centraliza o
  // marcador direto no L'América Shopping Center.
  mapsEmbedUrl:
    "https://www.google.com/maps?q=" +
    encodeURIComponent("L'América Shopping Center, Rua 13 de Maio 877, Bento Gonçalves, RS") +
    '&output=embed',
  city: 'Bento Gonçalves/RS',
  cnpj: '66.771.571/0001-38',
  shippingNote: 'Enviamos para todo o Brasil',
  freeShippingThreshold: 299,
  pixDiscountPercent: 5,
} as const;

// Nota (R17): YouTube e demais conteúdos de "Instagram e YouTube"/newsletter
// agora são editáveis no admin (SiteSettings). O Instagram fixo abaixo
// (`instagram`/`instagramHandle`) segue como fallback de primeira renderização.

// Nota (R14): os blocos legados `admin` (credencial fixa) e `coupons` (cupons
// hardcoded) foram removidos. O login usa autenticação real no backend (JWT) e
// os cupons vivem exclusivamente no banco (módulo /api/*/coupons).
