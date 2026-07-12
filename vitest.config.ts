// vitest設定。Next.jsのtsconfigパスエイリアス（@/ → src/）を解決する。
// APIルートのユニットテスト（例: create-cq）がルート内の @/lib/... importを
// たどれるようにするために必要。
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
