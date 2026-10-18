import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), {
    name: 'static-gzip',
    apply: 'build',
    // Сжимаем один раз при сборке, без нагрузки на прод-сервер.
    writeBundle(options, bundle) {
      for (const [file, chunk] of Object.entries(bundle)) {
        if (!/\.(?:js|css|html)$/.test(file)) continue
        const source = chunk.type === 'chunk' ? chunk.code : chunk.source
        const bytes = typeof source === 'string' ? Buffer.from(source) : source
        if (bytes.length < 1024) continue
        writeFileSync(join(options.dir ?? 'dist', `${file}.gz`), gzipSync(bytes, { level: 9 }))
      }
    },
  }],
  server: {
    proxy: { '/golosa': { target: `http://localhost:${process.env.PORT ?? 8787}` }, '/api': { target: `http://localhost:${process.env.PORT ?? 8787}`, ws: true } },
  },
  // самый большой кусок — three.js 3D-встречи (~640 кБ, 175 кБ gzip): грузится лениво, пока игрок читает бриф
  build: { manifest: true, chunkSizeWarningLimit: 700 },
})
