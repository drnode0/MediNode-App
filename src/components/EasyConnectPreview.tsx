'use client'

// ?preview=easyconnect / ?preview=off を受けて、登録先行の画面順序を
// このブラウザに30日おぼえさせる（設計書§17）。画面表示なし・副作用のみ。
// 判定そのものは easy-connect-preview.ts の純関数が持つ。

import { useEffect } from 'react'
import { previewActionFromSearch, writePreviewCookie, clearPreviewCookie } from '@/lib/easy-connect-preview'

export function EasyConnectPreview() {
  useEffect(() => {
    const action = previewActionFromSearch(window.location.search)
    if (action === 'set') writePreviewCookie()
    if (action === 'clear') clearPreviewCookie()
  }, [])
  return null
}
