import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target: `http://localhost:${process.env.PORT ?? 8787}`, ws: true } },
  },
  // самый большой кусок — three.js 3D-встречи (~640 кБ, 175 кБ gzip): грузится лениво, пока игрок читает бриф
  build: { chunkSizeWarningLimit: 700 },
})
