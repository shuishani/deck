import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // 相对路径：中继把 deck 挂在任意子路径下（如 /deck/）也能用。
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5175,
    proxy: { '/api': 'http://127.0.0.1:8765' },
  },
  build: {
    outDir: '../src/deck/static',
    emptyOutDir: true,
  },
})
