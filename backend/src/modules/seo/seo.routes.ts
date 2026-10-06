import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';

/**
 * Sitemap DINÂMICO — GET /api/public/sitemap.xml
 * Páginas institucionais + categorias ativas + produtos ativos, com URLs no
 * domínio da loja (APP_URL). O robots.txt do frontend aponta para cá (o build
 * troca a linha Sitemap quando VITE_API_URL está definido), então produto novo
 * entra no sitemap sem precisar de deploy.
 */
export const seoRouter = Router();

const STATIC_PAGES: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/loja', changefreq: 'daily', priority: '0.9' },
  { path: '/orcamento', changefreq: 'monthly', priority: '0.6' },
  { path: '/sobre', changefreq: 'monthly', priority: '0.5' },
  { path: '/materiais', changefreq: 'monthly', priority: '0.5' },
  { path: '/blog', changefreq: 'weekly', priority: '0.5' },
  { path: '/faq', changefreq: 'monthly', priority: '0.5' },
  { path: '/como-comprar', changefreq: 'monthly', priority: '0.4' },
  { path: '/trocas-devolucoes', changefreq: 'yearly', priority: '0.3' },
  { path: '/privacidade', changefreq: 'yearly', priority: '0.3' },
  { path: '/contato', changefreq: 'yearly', priority: '0.4' },
];

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

seoRouter.get(
  '/public/sitemap.xml',
  asyncHandler(async (_req, res) => {
    const base = env.APP_URL.replace(/\/+$/, '');
    const [categories, products] = await Promise.all([
      prisma.category.findMany({ where: { active: true }, select: { slug: true, updatedAt: true } }),
      prisma.product.findMany({ where: { active: true }, select: { slug: true, updatedAt: true } }),
    ]);

    const url = (path: string, changefreq: string, priority: string, lastmod?: Date) =>
      `  <url><loc>${xmlEscape(base + path)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;

    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...STATIC_PAGES.map((p) => url(p.path, p.changefreq, p.priority)),
      ...categories.map((c) => url(`/categoria/${encodeURIComponent(c.slug)}`, 'weekly', '0.8', c.updatedAt)),
      ...products.map((p) => url(`/produto/${encodeURIComponent(p.slug)}`, 'weekly', '0.7', p.updatedAt)),
      '</urlset>',
    ].join('\n');

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    // Cache de 1h no CDN da Vercel; produto novo aparece em até 1h.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600');
    res.send(body);
  }),
);
