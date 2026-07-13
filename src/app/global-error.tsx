'use client'

// 最上位（layout自体の描画）で例外が起きたときの最終防波堤。
// ここは <html>/<body> ごと差し替わるため、Tailwindに依存せずインラインstyleで最小限に描く。
// error.tsx が拾えない致命的エラーでも、真っ白ではなく再読み込み導線を出す。

import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('アプリの起動中にエラーが発生しました:', error)
  }, [error])

  return (
    <html lang="ja">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f9fafb', color: '#111827' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', boxSizing: 'border-box' }}>
          <div style={{ maxWidth: '320px', textAlign: 'center' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '12px' }}>アプリを起動できませんでした</h1>
            <p style={{ fontSize: '14px', color: '#4b5563', lineHeight: 1.7, marginBottom: '20px' }}>
              一時的な不具合の可能性があります。もう一度お試しください。設定やデータは失われていません。
            </p>
            <button
              onClick={reset}
              style={{ width: '100%', padding: '12px', borderRadius: '12px', background: '#196b4f', color: '#fff', fontSize: '14px', fontWeight: 600, border: 'none', cursor: 'pointer' }}
            >
              もう一度読み込む
            </button>
            {error.digest && (
              <p style={{ fontSize: '10px', color: '#d1d5db', fontFamily: 'monospace', marginTop: '16px' }}>エラーID: {error.digest}</p>
            )}
          </div>
        </div>
      </body>
    </html>
  )
}
