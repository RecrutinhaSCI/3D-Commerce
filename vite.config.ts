import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

/**
 * SEO com o domínio do cliente (VITE_SITE_URL). sitemap.xml, robots.txt e a
 * og:image precisam de URL ABSOLUTA; em `public/` elas ficam relativas e este
 * plugin completa no build. Sem VITE_SITE_URL o build segue, só com aviso.
 */
function seoAbsoluteUrls(siteUrl: string | undefined, apiUrl: string | undefined): Plugin {
  const base = siteUrl?.trim().replace(/\/+$/, '');
  const api = apiUrl?.trim().replace(/\/+$/, '');
  let outDir = 'dist';
  return {
    name: 'seo-absolute-urls',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    transformIndexHtml(html) {
      if (!base) return html;
      return html.replace(/((?:property="og:image"|name="twitter:image") content=")\//g, `$1${base}/`);
    },
    closeBundle() {
      if (!base) {
        this.warn('VITE_SITE_URL não definida — sitemap.xml/robots.txt ficam com URLs relativas.');
        return;
      }
      const rewrite = (file: string, from: RegExp, to: string) => {
        const p = path.join(outDir, file);
        if (fs.existsSync(p)) fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(from, to));
      };
      rewrite('sitemap.xml', /<loc>\//g, `<loc>${base}/`);
      // Com a API em URL absoluta, o robots aponta para o sitemap DINÂMICO
      // (inclui todos os produtos ativos); o estático fica como reserva.
      const dynamicSitemap = api && /^https?:\/\//.test(api) ? `Sitemap: ${api}/api/public/sitemap.xml\n` : '';
      rewrite('robots.txt', /^Sitemap: \/sitemap\.xml$/m, `${dynamicSitemap}Sitemap: ${base}/sitemap.xml`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), seoAbsoluteUrls(env.VITE_SITE_URL, env.VITE_API_URL)],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // Acesso externo (túnel para teste em celular). O front chama a API por
    // caminho relativo (/api) e o Vite faz proxy para o backend em :3333 —
    // assim um único link público serve loja + API, sem CORS.
    server: {
      host: true,
      allowedHosts: ['.trycloudflare.com', 'localhost'],
      proxy: {
        '/api': 'http://localhost:3333',
        '/uploads': 'http://localhost:3333',
      },
    },
  };
});
