import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // The app shell is precached so a cold start with no connection still
      // reaches a working till rather than a browser error page.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        // Business data lives in IndexedDB and syncs through the engine; it is
        // deliberately never written into the HTTP cache.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Point of Sale',
        short_name: 'POS',
        description: 'Offline-first point of sale, inventory and costing.',
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['business', 'productivity'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  // The shared package is TypeScript source in the workspace, not a built
  // dependency, so it must not be pre-bundled.
  optimizeDeps: { exclude: ['@pos/shared'] },
  server: {
    port: 5174,
    /**
     * Never quietly move to another port.
     *
     * The till's entire database is IndexedDB, which is scoped to the origin -
     * so a different port is a different database. Hopping to 5175 because
     * something else took 5174 would present an empty, unenrolled till and
     * look exactly like data loss. Failing to start is the safer answer.
     */
    strictPort: true,
    host: true,
    fs: { allow: ['..', '../..'] },
  },
  build: { target: 'es2022', sourcemap: true },
})
