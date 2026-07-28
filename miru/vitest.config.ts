import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Pure-function unit tests only (lib/prompts). No React rendering, so no jsdom/plugin —
// keeps the toolchain off the React 19 peer-dep conflict. The '@/' alias mirrors tsconfig.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
