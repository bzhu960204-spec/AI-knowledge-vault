import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Backend port is injected by start-dev.ps1 (BACKEND_PORT) so the /api proxy
// always targets the actual backend, even when the default port is occupied.
const backendPort = process.env.BACKEND_PORT ?? '8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
      '/uploads': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
})
