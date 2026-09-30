import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
    plugins: [react()],
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
});
