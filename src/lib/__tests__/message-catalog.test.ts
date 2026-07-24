import { describe, it, expect } from 'vitest'
import {
  MESSAGE_CATALOG,
  summarizeCatalog,
  CHANNEL_LABELS,
  type CatalogFlag,
} from '../message-catalog'

const VALID_FLAGS: CatalogFlag[] = ['maintenance', 'daily_question', 'push']

describe('MESSAGE_CATALOG 整合性', () => {
  it('id は一意', () => {
    const ids = MESSAGE_CATALOG.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('全項目に必須フィールドがある', () => {
    for (const it of MESSAGE_CATALOG) {
      expect(it.name).toBeTruthy()
      expect(it.where).toBeTruthy()
      expect(it.trigger).toBeTruthy()
      expect(it.frequency).toBeTruthy()
      expect(CHANNEL_LABELS[it.channel]).toBeTruthy()
    }
  })

  it('flag は3種のいずれか、かつ controllable=true と対応', () => {
    for (const it of MESSAGE_CATALOG) {
      if (it.flag) {
        expect(VALID_FLAGS).toContain(it.flag)
        expect(it.controllable).toBe(true)
      }
    }
  })

  it('改善候補・準備中の項目が health 付きで存在する', () => {
    const byId = new Map(MESSAGE_CATALOG.map((i) => [i.id, i]))
    expect(byId.get('push-resolved-cq')?.health?.level).toBe('unwired')
    expect(byId.get('banner-announcement')?.health?.level).toBe('gap')
    // env罠はライブ判定なのでレジストリ側は push-daily が flag:push を持つことだけ確認
    expect(byId.get('push-daily')?.flag).toBe('push')
    // 実装済みで正常なものには health を付けない（今日の1問カード等）
    expect(byId.get('card-daily-question')?.health).toBeUndefined()
    expect(byId.get('push-daily')?.health).toBeUndefined()
    expect(byId.get('modal-onboarding')?.health).toBeUndefined()
  })

  it('行内コントロールは1フラグ1行だけ（primaryControl）', () => {
    const byId = new Map(MESSAGE_CATALOG.map((i) => [i.id, i]))
    // 各フラグの主操作行
    expect(byId.get('gate-maintenance')?.primaryControl).toBe(true)
    expect(byId.get('card-daily-question')?.primaryControl).toBe(true)
    expect(byId.get('push-daily')?.primaryControl).toBe(true)
    // 同じ push フラグを共有するお知らせ送信は主操作行にしない（段階の二重操作を避ける）
    expect(byId.get('push-announce')?.primaryControl).toBeUndefined()
    // primaryControl は必ず flag を伴い、フラグごとに1つだけ
    const byFlag = new Map<string, number>()
    for (const it of MESSAGE_CATALOG) {
      if (it.primaryControl) {
        expect(it.flag).toBeTruthy()
        byFlag.set(it.flag!, (byFlag.get(it.flag!) ?? 0) + 1)
      }
    }
    for (const [, n] of byFlag) expect(n).toBe(1)
  })
})

describe('summarizeCatalog', () => {
  it('カテゴリ別件数・操作可能数・要注意を集計', () => {
    const s = summarizeCatalog(MESSAGE_CATALOG)
    expect(s.total).toBe(MESSAGE_CATALOG.length)
    const sum =
      s.byChannel.push +
      s.byChannel.banner +
      s.byChannel.modal +
      s.byChannel.quiet +
      s.byChannel.settings
    expect(sum).toBe(s.total)
    // Push実弾2＋死にチャネル1
    expect(s.byChannel.push).toBe(3)
    // 操作できるのは少数（flag付き＋broadcast）
    expect(s.controllable).toBeGreaterThanOrEqual(3)
    expect(s.controllable).toBeLessThan(s.total)
    // 要注意には死にチャネルとハードコードお知らせを含む
    const issueIds = s.issues.map((i) => i.id)
    expect(issueIds).toContain('push-resolved-cq')
    expect(issueIds).toContain('banner-announcement')
  })

  it('空配列でも落ちない', () => {
    const s = summarizeCatalog([])
    expect(s.total).toBe(0)
    expect(s.controllable).toBe(0)
    expect(s.issues).toEqual([])
  })
})
