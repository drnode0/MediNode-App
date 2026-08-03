// isUnreadableDbErrorCode は「このデータベースを読めないと名指ししてよいか」を決める
// 唯一の判定関数（notion-readability.ts と OAuthFinish の check-props 分岐の両方が使う）。
// 一時的な失敗（レート制限・トランスポート層のエラー・コード無し）まで「読めない」と
// 誤って断定させないための表を、そのまま表明する。
import { describe, it, expect } from 'vitest'
import { isUnreadableDbErrorCode } from '../connection-errors'

describe('isUnreadableDbErrorCode', () => {
  it.each([
    // [説明, コード, 期待値]
    ['権限系（restricted_resource）は読めないと断定してよい', 'restricted_resource', true],
    ['権限系（unauthorized）は読めないと断定してよい', 'unauthorized', true],
    ['存在しない（object_not_found）も読めないと断定してよい', 'object_not_found', true],
    ['レート制限（rate_limited）は一時的な失敗の可能性があり断定しない', 'rate_limited', false],
    ['トランスポート層のエラー（notionhq_client_response_error）は断定しない', 'notionhq_client_response_error', false],
    ['未知のコードは断定しない', 'some_unknown_code', false],
    ['コード無し（undefined）は断定しない', undefined, false],
    ['コード無し（null）は断定しない', null, false],
    ['空文字は断定しない', '', false],
  ] as const)('%s', (_desc, code, expected) => {
    expect(isUnreadableDbErrorCode(code)).toBe(expected)
  })
})
