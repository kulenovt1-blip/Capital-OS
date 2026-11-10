import { defineConfig } from 'vite';

// Номер сборки на экране «Ещё»: короткий хэш коммита и дата — чтобы было видно, какая версия открыта (в CI хэш даёт GITHUB_SHA).
const BUILD = { sha: (process.env.GITHUB_SHA ?? 'dev').slice(0, 7), date: new Date().toISOString().slice(0, 10) };

// Относительный base — сборка работает на GitHub Pages в подпапке репозитория.
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD) },
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as Parameters<typeof defineConfig>[0]);
