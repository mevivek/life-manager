import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * **Plugin order is significant.** `tanstackRouter` must come BEFORE `react`: it generates
 * `routeTree.gen.ts` and rewrites route modules, and the React plugin's Babel transform has to
 * see the result, not the source.
 *
 * Tailwind v4 is a Vite plugin, not a PostCSS config. There is deliberately no
 * `tailwind.config.js` and no `postcss.config.js` — the theme lives in `src/styles.css` under
 * `@theme`.
 */
export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'life-manager',
        short_name: 'life',
        description: 'Documents, assets, money, people, notes — in one place.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        /**
         * App shell only. The service worker must NEVER answer an API call from cache:
         *
         *  - `navigateFallbackDenylist` keeps `/api/*` navigations away from index.html.
         *  - No `runtimeCaching` entry for the API at all, so responses are never stored.
         *
         * Offline READ caching is ADR-0013 / M2 work. Adding it here would mean serving a
         * stale `/me` — and therefore a stale space list — which is the one thing this app
         * must not do (conventions/code.md §9).
         */
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    /**
     * Makes local development SAME-ORIGIN, which sidesteps cookies and CORS entirely while
     * developing. Production is same-SITE instead, via two subdomains of one domain — see
     * ADR-0019. That difference is why `VITE_API_URL` is empty locally and set in production.
     */
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
  build: {
    // Sourcemaps: this is a private personal app, and a stack trace that names a real file is
    // worth far more here than the marginal obscurity of hiding one.
    sourcemap: true,
  },
})
