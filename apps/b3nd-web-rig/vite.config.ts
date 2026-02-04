import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
    alias: [
      { find: '@bandeira-tech/b3nd-web/wallet', replacement: path.resolve(__dirname, '../../libs/b3nd-wallet/mod.ts') },
      { find: '@bandeira-tech/b3nd-web/apps', replacement: path.resolve(__dirname, '../../libs/b3nd-apps/mod.ts') },
      { find: '@bandeira-tech/b3nd-web/encrypt', replacement: path.resolve(__dirname, '../../libs/b3nd-encrypt/mod.ts') },
      { find: '@bandeira-tech/b3nd-web/blob', replacement: path.resolve(__dirname, '../../libs/b3nd-blob/mod.ts') },
      { find: '@bandeira-tech/b3nd-web/clients/http', replacement: path.resolve(__dirname, '../../libs/b3nd-client-http/mod.ts') },
      { find: '@bandeira-tech/b3nd-web', replacement: path.resolve(__dirname, '../../libs/b3nd-sdk/src/mod.web.ts') },
    ],
  },
  optimizeDeps: {
    include: [
      '@bandeira-tech/b3nd-web',
      '@bandeira-tech/b3nd-web/wallet',
      '@bandeira-tech/b3nd-web/apps',
      '@bandeira-tech/b3nd-web/encrypt',
      '@bandeira-tech/b3nd-web/blob',
      '@bandeira-tech/b3nd-web/clients/http',
    ],
    esbuildOptions: {
      resolveExtensions: ['.ts', '.tsx', '.js', '.mjs', '.jsx'],
    },
  },
  server: {
    fs: {
      allow: [
        __dirname,
        path.resolve(__dirname, '..'),
        path.resolve(__dirname, '../../libs'),
        path.resolve(__dirname, '../../'),
      ],
    },
    proxy: {
      '/api/dashboard': {
        target: 'http://localhost:5556',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/dashboard/, ''),
      },
    },
  },
})
