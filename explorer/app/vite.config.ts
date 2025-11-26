import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
    alias: [
      { find: '@bandeira-tech/b3nd-web/wallet', replacement: path.resolve(__dirname, '../../sdk/wallet/mod.ts') },
      { find: '@bandeira-tech/b3nd-web/apps', replacement: path.resolve(__dirname, '../../sdk/apps/mod.ts') },
      { find: '@bandeira-tech/b3nd-web/encrypt', replacement: path.resolve(__dirname, '../../sdk/encrypt/mod.ts') },
      { find: '@bandeira-tech/b3nd-web/clients/http', replacement: path.resolve(__dirname, '../../sdk/clients/http/mod.ts') },
      { find: '@bandeira-tech/b3nd-web', replacement: path.resolve(__dirname, '../../sdk/src/mod.web.ts') },
    ],
  },
  optimizeDeps: {
    include: [
      '@bandeira-tech/b3nd-web',
      '@bandeira-tech/b3nd-web/wallet',
      '@bandeira-tech/b3nd-web/apps',
      '@bandeira-tech/b3nd-web/encrypt',
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
        path.resolve(__dirname, '../../sdk'),
        path.resolve(__dirname, '../../'),
      ],
    },
  },
})
