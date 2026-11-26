import { defineConfig } from 'vite';

export default defineConfig({
  base: '/Underwater-world-model/',
  build: { sourcemap: true, rollupOptions: { input: { atlas: "index.html", console: "console.html" } } }
});
