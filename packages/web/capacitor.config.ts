import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Native packaging for Android and iOS.
 *
 * The identical web build that runs in the browser is what ships inside the
 * app: Capacitor serves the compiled `dist` from the device itself, so the
 * till starts and completes sales with no network at all. Nothing about the
 * architecture changes between the three platforms.
 */
const config: CapacitorConfig = {
  appId: 'com.pos.offlinefirst',
  // Written by `npm run brand` from brand.config.json. Left as a plain literal
  // on purpose: Capacitor's CLI loads this file as CommonJS, so a runtime
  // import here fails before the config is ever read.
  appName: 'Couz Coffee POS',
  webDir: 'dist',

  android: {
    // A self-hosted sync server on a shop's own network is typically plain
    // HTTP on a local address. Android blocks that by default, so it is
    // enabled deliberately here rather than silently failing to sync.
    allowMixedContent: true,
  },

  server: {
    androidScheme: 'https',
    cleartext: true,
  },

  plugins: {
    CapacitorHttp: { enabled: false },
  },
}

export default config
