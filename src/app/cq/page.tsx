'use client'
import { CqCaptureProvider } from '@/components/CqCapture'
import { UnresolvedCqScreen } from '@/components/FloatingCqs'

// 未解決の問いが浮かぶ画面。ホームのタブは既に6本あるため、7本目を足さず独立ルートに置く。
// CqCaptureProvider で包むのは、パネルの「作者に投げる」と空状態の「疑問を残す」が
// 捕捉モーダルを開くため（ホームと同じ入口を使い、投稿の作法を二重に持たない）。
export default function CqPage() {
  return (
    <CqCaptureProvider>
      <UnresolvedCqScreen />
    </CqCaptureProvider>
  )
}
