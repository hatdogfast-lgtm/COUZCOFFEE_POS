import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import { cp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * Leave a second copy of the built site at the repository root.
 *
 * Vite writes to packages/web/dist, which is where Capacitor picks it up, so
 * that cannot move. Vercel looks wherever its project settings say - and a
 * Root Directory, Framework Preset or Build Command set in its dashboard
 * silently overrides vercel.json, which is how a build that plainly worked
 * ends with "No Output Directory named dist found".
 *
 * Doing it here rather than in an npm script means it happens on any build at
 * all, including a bare `vite build`, so no hosting configuration can miss it.
 */
function alsoBuildToRepoRoot() {
  return {
    name: 'stage-build-at-repo-root',
    apply: 'build' as const,
    // After every other plugin has finished writing. The service worker is
    // generated in the PWA plugin's own closeBundle, and a copy taken before
    // that lands is a site that cannot work offline - which is most of the
    // point of this application.
    enforce: 'post' as const,
    async closeBundle() {
      const here = path.dirname(fileURLToPath(import.meta.url))
      const from = path.resolve(here, 'dist')
      const to = path.resolve(here, '../../dist')
      await rm(to, { recursive: true, force: true })
      await cp(from, to, { recursive: true })
      console.log('  also written to dist/ at the repository root, for hosting')
    },
  }
}

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
    alsoBuildToRepoRoot(),
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
