import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    include: ['test/**/*.test.ts', '!test/**/*.client.test.ts'],
    exclude: [
      'test/preview-player.test.ts',
      'test/playlist-store.test.ts',
      'test/top-nav-preview.test.ts',
      'test/catalog-adapter.test.ts',
      'test/covers.test.ts',
      'test/queue-panel.test.ts',
      'test/mini-bar.test.ts',
      'test/mini-bar-cast.test.ts',
      'test/playlist-store-cast.test.ts',
      'test/receiver-controller.test.ts',
    ],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml', environment: 'dev' },
        miniflare: {
          bindings: {
            SONAR_API_KEY: 'test-sonar-key',
            JWT_TTL_SECONDS: '3600',
            SESSION_TTL_SECONDS: '43200',
            STREAM_WORKER_URL: 'https://stream.test',
            PARTNER_ID: 'partner-test',
            DEMO_USERS: 'alice:wonderland',
            ISS_OVERRIDE: '',
          },
        },
      },
    },
  },
})
