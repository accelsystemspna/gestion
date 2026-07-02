import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        navigateFallbackDenylist: [/^\/icon-gen\.html$/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin.includes('supabase.co'),
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'Gestión — Carpintería · Melamina · Impresión 3D',
        short_name: 'Gestión',
        description: 'Panel de gestión: ventas, presupuestos, clientes y productos',
        theme_color: '#241C5C',
        background_color: '#F0ECE2',
        display: 'standalone',
        start_url: '/ventas',
        icons: [
          { src: '/icons/pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/pwa/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/pwa/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
})
