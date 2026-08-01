// 列名マッピング（buildPropMap）のテスト。
// 既存のNotion DBを「列名を書き換えずに」つなぐための読み替え表を組み立てる。
// 同期API・接続テストAPIは未指定キーを既定名（要約/キーワード/知識レベル/ジャンル）で解決するので、
// 空欄は「キーごと落とす」のが正しい（'' を送ると空文字の列を探しに行ってしまう）。
import { describe, it, expect } from 'vitest'
import { buildPropMap } from '../settings'

describe('buildPropMap', () => {
  it('未設定なら空オブジェクト（APIが既定名で解決する）', () => {
    expect(buildPropMap({})).toEqual({})
    expect(buildPropMap(null)).toEqual({})
  })

  it('入力された列名だけを載せる', () => {
    expect(buildPropMap({ propSummary: 'サマリー', propGenre: '' })).toEqual({ summary: 'サマリー' })
  })

  it('前後の空白は落とす（コピペ由来の空白で列が見つからない事故を防ぐ）', () => {
    expect(buildPropMap({ propKeywords: '  タグ  ' })).toEqual({ keywords: 'タグ' })
  })

  it('空白だけの入力は未設定と同じ扱い', () => {
    expect(buildPropMap({ propSummary: '   ' })).toEqual({})
  })

  it('4項目すべてを読み替えられる', () => {
    expect(
      buildPropMap({
        propSummary: '概要',
        propKeywords: 'タグ',
        propKnowledgeLevel: '習熟度',
        propGenre: 'カテゴリ',
      }),
    ).toEqual({ summary: '概要', keywords: 'タグ', knowledgeLevel: '習熟度', genre: 'カテゴリ' })
  })
})
