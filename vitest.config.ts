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
  test: {
    // .worktrees配下（別ブランチの作業コピー）を二重収集しない。
    // 混ぜると @ エイリアスがmainのsrcを指したままworktree側の相対importと
    // 食い違い、vi.mockが効かず偽の失敗が出る（2026-08-12に実際に発生）。
    exclude: ['**/node_modules/**', '**/.worktrees/**', '**/.next/**'],
  },
})
