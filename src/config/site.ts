export const site = {
  name: '3DCommerce',
  tagline: 'Tudo para impressão 3D em um só lugar',
  whatsapp: '5554992752253',
  whatsappDisplay: '(54) 99275-2253',
  email: 'commerce3d@outlook.com',
  instagram: 'https://www.instagram.com/3dcommerce_bg/',
  instagramHandle: '@3dcommerce_bg',
  address: "L'América Shopping Center — Rua 13 de Maio, 877, São Bento, Bento Gonçalves/RS",
  mapsUrl: 'https://maps.app.goo.gl/ppFbmAxauMKhj3vf8',
  mapsEmbedQuery: "L'América Shopping Center, Rua 13 de Maio 877, Bento Gonçalves RS",
  city: 'Bento Gonçalves/RS',
  cnpj: '66.771.571/0001-38',
  shippingNote: 'Enviamos para todo o Brasil',
  freeShippingThreshold: 299,
  pixDiscountPercent: 5,
  /**
   * Parcelamento no cartão — FONTE ÚNICA (página do produto, "Como comprar" e
   * limite do formulário de cartão). `interestFree: true` só é verdade se a
   * conta do Mercado Pago do cliente estiver configurada para absorver os juros
   * ("parcelamento sem juros"); senão o MP cobra juros do comprador.
   */
  installments: { max: 6, interestFree: true },
} as const;

// Nota (R17): YouTube e demais conteúdos de comunidade/newsletter agora são
// editáveis no admin (SiteSettings). O Instagram fixo abaixo (`instagram`/
// `instagramHandle`) segue como fallback de primeira renderização.

// Nota (R14): os blocos legados `admin` (credencial fixa) e `coupons` (cupons
// hardcoded) foram removidos. O login usa autenticação real no backend (JWT) e
// os cupons vivem exclusivamente no banco (módulo /api/*/coupons).
