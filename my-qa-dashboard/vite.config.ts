import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/echarts') ||
            id.includes('node_modules/zrender') ||
            id.includes('node_modules/echarts-for-react')
          ) {
            return 'vendor-echarts';
          }
          if (
            id.includes('node_modules/@duckdb/duckdb-wasm') ||
            id.includes('node_modules/apache-arrow')
          ) {
            return 'vendor-duckdb';
          }
          if (id.includes('node_modules/@tanstack/react-virtual')) {
            return 'vendor-virtual';
          }
        },
      },
    },
  },
})
