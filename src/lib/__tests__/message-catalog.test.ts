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

  it('既知の要注意3件が health 付きで存在する', () => {
    const byId = new Map(MESSAGE_CATALOG.map((i) => [i.id, i]))
    expect(byId.get('push-resolved-cq')?.health?.level).toBe('dead')
    expect(byId.get('banner-announcement')?.health?.level).toBe('hardcoded')
    // env罠はライブ判定なのでレジストリ側は push-daily が flag:push を持つことだけ確認
    expect(byId.get('push-daily')?.flag).toBe('push')
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
