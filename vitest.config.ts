import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Testes do FRONTEND (o backend tem o próprio vitest.config em backend/).
// Renderização via react-dom/server: não precisa de DOM simulado.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
