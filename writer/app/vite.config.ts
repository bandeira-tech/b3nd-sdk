import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175
  },
  resolve: {
    alias: {
      '@bandeira-tech/b3nd-sdk/wallet': path.resolve(__dirname, '../../sdk/wallet/mod.ts'),
      '@bandeira-tech/b3nd-sdk/apps': path.resolve(__dirname, '../../sdk/apps/mod.ts'),
      '@bandeira-tech/b3nd-sdk': path.resolve(__dirname, '../../sdk/src/mod.ts'),
    },
  },
})
