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
