import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync, readFileSync } from 'node:fs';

// Deployment configuration (design §16.3): never committed.
// Order: GOOGLE_CLIENT_ID environment variable (Cloudflare build setting),
// then the uncommitted config.local.json, else empty (the app lets you paste one at runtime).
function googleClientId(): string {
  if (process.env.GOOGLE_CLIENT_ID) return process.env.GOOGLE_CLIENT_ID;
  if (existsSync('config.local.json')) {
    try {
      return JSON.parse(readFileSync('config.local.json', 'utf8')).googleClientId ?? '';
    } catch {
      return '';
    }
  }
  return '';
}

export default defineConfig({
  define: {
    __GOOGLE_CLIENT_ID__: JSON.stringify(googleClientId()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script', // external registerSW.js; no inline script, so the CSP stays strict
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'MayaLib Spike 0',
        short_name: 'MayaLib S0',
        description: 'Feasibility tests for MayaLib',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,wasm,mjs}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/_/],
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
