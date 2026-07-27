import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Só testes do código-fonte — nunca coletar o build em dist/.
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'uploads'],
  },
});
