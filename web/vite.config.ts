import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// During development the UI proxies API calls to a running opa-studio backend.
const backend = process.env.OPA_STUDIO_BACKEND ?? 'http://127.0.0.1:9080'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    sourcemap: false,
  },
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/cp': { target: backend, changeOrigin: true },
    },
  },
  test: {
    environment: 'node',
  },
} as never)
