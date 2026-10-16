import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    {
      name: 'html-as-text',
      enforce: 'pre',
      load: (id) => (id.endsWith('.html') ? `export default ${JSON.stringify(readFileSync(id, 'utf8'))}` : undefined),
    },
  ],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
})
