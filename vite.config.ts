import { defineConfig } from 'vite';

// Относительный base — сборка работает на GitHub Pages в подпапке репозитория.
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as Parameters<typeof defineConfig>[0]);
