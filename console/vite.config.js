import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // react-draggable (inside react-grid-layout) reads this in its browser
    // build; without a define, `process` is undefined in the browser and every
    // drag/resize handler throws before moving anything.
    'process.env.DRAGGABLE_DEBUG': 'false',
  },
  resolve: {
    // Prisma Studio (a server dependency) puts React 18 in the root
    // node_modules; console packages hoisted there would otherwise load it next
    // to the console's own React 19 — two Reacts, and every hook throws.
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // IPv4 on purpose: `localhost` resolves to ::1 first, and another dev
        // server bound to [::1]:3000 would silently answer in the API's place.
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
})
