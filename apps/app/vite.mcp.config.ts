import { defineConfig } from 'vite'
import path from 'node:path'

// Build the same headless domain commands used by the editor for the Node server.
export default defineConfig({
  publicDir: false,
  resolve: {
    alias: {
      '@/lib/junction/junctionHostedHooks': path.resolve(import.meta.dirname, 'src/editions/community/communityJunctionHooks.ts'),
      '@/lib/junction/junctionCommandHooks': path.resolve(import.meta.dirname, 'src/editions/community/communityJunctionCommandHooks.ts'),
      '@': path.resolve(import.meta.dirname, 'src'),
      '@eendra/app-edition': path.resolve(import.meta.dirname, '../../packages/app-edition/src/index.ts'),
    },
  },
  build: {
    ssr: 'community/mcp.ts',
    outDir: 'community/dist',
    emptyOutDir: true,
    target: 'node24',
    sourcemap: true,
    rolldownOptions: {
      output: { entryFileNames: 'mcp.mjs', chunkFileNames: '[name]-[hash].mjs' },
    },
  },
})
