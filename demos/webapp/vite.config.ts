import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Vite serves the SPA from ./public during dev (proxied to /api/* on the local
// webapp worker) and builds it to ./dist where Workers Static Assets picks it up.
export default defineConfig({
  root: 'public',
  publicDir: false,
  server: {
    port: 15174,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:8788', changeOrigin: true },
      '/.well-known': { target: 'http://localhost:8788', changeOrigin: true },
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'public/index.html'),
    },
  },
})
