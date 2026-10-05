import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
/**
 * SEO com o domínio do cliente (VITE_SITE_URL). sitemap.xml, robots.txt e a
 * og:image precisam de URL ABSOLUTA; em `public/` elas ficam relativas e este
 * plugin completa no build. Sem VITE_SITE_URL o build segue, só com aviso.
 */
function seoAbsoluteUrls(siteUrl) {
    var base = siteUrl === null || siteUrl === void 0 ? void 0 : siteUrl.trim().replace(/\/+$/, '');
    var outDir = 'dist';
    return {
        name: 'seo-absolute-urls',
        apply: 'build',
        configResolved: function (config) {
            outDir = path.resolve(config.root, config.build.outDir);
        },
        transformIndexHtml: function (html) {
            if (!base)
                return html;
            return html.replace(/(property="og:image" content=")\//, "$1".concat(base, "/"));
        },
        closeBundle: function () {
            if (!base) {
                this.warn('VITE_SITE_URL não definida — sitemap.xml/robots.txt ficam com URLs relativas.');
                return;
            }
            var rewrite = function (file, from, to) {
                var p = path.join(outDir, file);
                if (fs.existsSync(p))
                    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(from, to));
            };
            rewrite('sitemap.xml', /<loc>\//g, "<loc>".concat(base, "/"));
            rewrite('robots.txt', /^Sitemap: \//m, "Sitemap: ".concat(base, "/"));
        },
    };
}
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), 'VITE_');
    return {
        plugins: [react(), seoAbsoluteUrls(env.VITE_SITE_URL)],
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
