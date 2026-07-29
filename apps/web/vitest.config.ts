import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Separate from `vite.config.ts` on purpose: the router plugin and the PWA plugin have no place
 * in a component test run, and VitePWA in particular writes a service worker to disk.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  /**
   * Must mirror `vite.config.ts`'s `define`. This config is separate from the build's, so a global
   * declared only there is `undefined` here and any module reading it at import time throws
   * `__APP_VERSION__ is not defined` — which looks like a broken test rather than a missing define.
   */
  define: {
    __APP_VERSION__: JSON.stringify('test'),
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
