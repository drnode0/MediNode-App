import { describe, expect, it } from 'vitest'
import { leafDestination, notionUrlFor } from '../vine-open'

const SUB = 'subscription_1f2e3d4c5b6a7988990a1b2c3d4e5f60'
const PERSONAL = 'personal_1f2e3d4c-5b6a-7988-990a-1b2c3d4e5f60'

describe('葉から本文への行き先', () => {
  it('サブスク配信はアプリ内リーダー（節サフィックスは親ページに解決する）', () => {
    expect(leafDestination(SUB, true)).toEqual({ mode: 'reader', objectID: SUB })
    expect(leafDestination(`${SUB}#sec3`, true)).toEqual({ mode: 'reader', objectID: SUB })
  })

  it('プレミアムが無効なあいだ、サブスク配信の行き先は無い（本文APIが会員ゲートのため）', () => {
    expect(leafDestination(SUB, false)).toEqual({ mode: 'none' })
  })

  it('個人・部署はNotionを開く（アプリ内リーダーはサブスク配信専用）', () => {
    expect(leafDestination(PERSONAL, true)).toEqual({
      mode: 'notion',
      url: 'https://www.notion.so/1f2e3d4c5b6a7988990a1b2c3d4e5f60',
    })
    expect(leafDestination('team_1f2e3d4c5b6a7988990a1b2c3d4e5f60', false).mode).toBe('notion')
  })

  it('形式が読めないidは行き先を作らない（devハーネスの見本・旧データ）', () => {
    expect(leafDestination('demo-3', true)).toEqual({ mode: 'none' })
    expect(leafDestination('personal_not-a-page-id', true)).toEqual({ mode: 'none' })
    expect(leafDestination('', true)).toEqual({ mode: 'none' })
    expect(leafDestination('1f2e3d4c5b6a7988990a1b2c3d4e5f60', true)).toEqual({ mode: 'none' })
  })

  it('NotionのURLはページidから作る（台帳にURLを持たせない）', () => {
    expect(notionUrlFor('1f2e3d4c-5b6a-7988-990a-1b2c3d4e5f60')).toBe(
      'https://www.notion.so/1f2e3d4c5b6a7988990a1b2c3d4e5f60',
    )
    expect(notionUrlFor('ページではない')).toBe('')
  })
})
