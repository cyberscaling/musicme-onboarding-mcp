import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    include: ['test/playlist-store.test.ts', 'test/catalog-adapter.test.ts', 'test/covers.test.ts', 'test/queue-panel.test.ts', 'test/mini-bar.test.ts'],
    environment: 'happy-dom',
    setupFiles: ['test/setup-drag-event.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'public'),
    },
  },
})
