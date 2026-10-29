import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

const apiTarget = process.env.WAYDINE_API_PROXY ?? 'http://localhost:4000'

export default defineConfig({
  resolve: {
    alias: {
      '@contract': path.resolve(import.meta.dirname, '../backend/src/contract/api.ts'),
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  preview: {
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
      manifest: {
        name: 'WayDine',
        short_name: 'WayDine',
        description: 'Find restaurants on your driving route, with the extra time each stop adds.',
        theme_color: '#2F4F2F',
        background_color: '#FAF8F2',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('mapbox-gl')) return 'mapbox'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
