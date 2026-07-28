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

        /**
         * Adds the `push` and `notificationclick` listeners to the generated worker.
         *
         * `importScripts` rather than switching to the `injectManifest` strategy: `generateSW` is
         * doing its job correctly, and taking over the whole worker to add two event listeners
         * would mean owning the precache manifest by hand forever.
         *
         * **This is load-bearing for M1's "done when".** `userVisibleOnly: true` obliges every push
         * to show a notification, so a worker with no `push` listener receives the message and
         * displays nothing — or, in some browsers, a generic "site updated in the background"
         * notice. The reminder pipeline ends in `public/push-sw.js`.
         */
        importScripts: ['/push-sw.js'],
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
     * Vite refuses requests whose `Host` header it does not recognise (a DNS-rebinding
     * defence). A Cloudflare Tunnel arrives as `app.mevivek.dev`, so without this the phone
     * gets a blank "host not allowed" page and the dev server logs nothing useful.
     *
     * Listed explicitly rather than `allowedHosts: true` — the wildcard disables the check
     * altogether, and this is a dev server pointed at a database with real credentials.
     */
    allowedHosts: ['app.mevivek.dev', 'localhost', '127.0.0.1'],
    /**
     * Makes local development SAME-ORIGIN, which sidesteps cookies and CORS entirely while
     * developing. Production is same-SITE instead, via two subdomains of one domain — see
     * ADR-0019. That difference is why `VITE_API_URL` is empty locally and set in production.
     *
     * Note the proxy is bypassed entirely when `VITE_API_URL` is set: the client then calls
     * the absolute origin directly, which is what makes the tunnel exercise the real
     * cross-subdomain path instead of this shortcut.
     */
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
  /**
   * `vite preview` serves the built output, which is the only way to exercise the service
   * worker and the web manifest — `devOptions.enabled` is false above, so PWA install does not
   * work against the dev server at all. It needs its own `allowedHosts`; the `server` block's
   * does not apply here.
   */
  preview: {
    port: 5173,
    allowedHosts: ['app.mevivek.dev', 'localhost', '127.0.0.1'],
  },
  build: {
    // Sourcemaps: this is a private personal app, and a stack trace that names a real file is
    // worth far more here than the marginal obscurity of hiding one.
    sourcemap: true,
  },
})
