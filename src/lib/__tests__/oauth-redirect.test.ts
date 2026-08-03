// redirect_uri組み立ての共有ヘルパー。認可URL（page.tsx）とコード交換（callback route）の
// 双方がここを通ることで、1文字でも違うとNotionに拒まれる redirect_uri を確実に一致させる。
import { describe, it, expect } from 'vitest'
import {
  NOTION_OAUTH_CALLBACK_PATH,
  redirectUriFromRequestUrl,
  redirectUriFromHost,
} from '../oauth-redirect'

describe('redirectUriFromHost', () => {
  it('本番の https ホスト（x-forwarded-proto あり）', () => {
    expect(redirectUriFromHost({ host: 'app.example', forwardedProto: 'https' })).toBe(
      'https://app.example' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })

  it('localhost（ポート付き）は forwardedProto が無くても http', () => {
    expect(redirectUriFromHost({ host: 'localhost:3000' })).toBe(
      'http://localhost:3000' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })

  it('127.0.0.1:3000 は http', () => {
    expect(redirectUriFromHost({ host: '127.0.0.1:3000' })).toBe(
      'http://127.0.0.1:3000' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })

  it('[::1]:3000 は http', () => {
    expect(redirectUriFromHost({ host: '[::1]:3000' })).toBe(
      'http://[::1]:3000' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })

  it('192.168.x.x のLANホスト（forwardedProto無し）は http（実機検証で使う経路）', () => {
    expect(redirectUriFromHost({ host: '192.168.1.42:3000' })).toBe(
      'http://192.168.1.42:3000' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })

  it('10.x.x.x のプライベートレンジも http', () => {
    expect(redirectUriFromHost({ host: '10.0.0.5:3000' })).toBe(
      'http://10.0.0.5:3000' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })

  it('172.16.x.x はプライベートレンジ内なので http', () => {
    expect(redirectUriFromHost({ host: '172.16.0.1:3000' })).toBe(
      'http://172.16.0.1:3000' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })

  it('172.31.x.x もプライベートレンジ内（上限）なので http', () => {
    expect(redirectUriFromHost({ host: '172.31.255.255:3000' })).toBe(
      'http://172.31.255.255:3000' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })

  it('172.15.x.x はプライベートレンジ外（下限の外側）なので https', () => {
    expect(redirectUriFromHost({ host: '172.15.255.255:3000' })).toBe(
      'https://172.15.255.255:3000' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })

  it('172.32.x.x はプライベートレンジ外なので https', () => {
    expect(redirectUriFromHost({ host: '172.32.0.1:3000' })).toBe(
      'https://172.32.0.1:3000' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })

  it('x-forwarded-proto: https が明示されていればプライベートホストでも上書きされる', () => {
    expect(redirectUriFromHost({ host: '192.168.1.42:3000', forwardedProto: 'https' })).toBe(
      'https://192.168.1.42:3000' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })

  it('ホストの大文字は小文字に正規化される', () => {
    expect(redirectUriFromHost({ host: 'APP.EXAMPLE', forwardedProto: 'https' })).toBe(
      'https://app.example' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })

  it('既定ポートは取り除かれる', () => {
    expect(redirectUriFromHost({ host: 'app.example:443', forwardedProto: 'https' })).toBe(
      'https://app.example' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })
})

describe('redirectUriFromRequestUrl', () => {
  it('リクエストURLからcallbackパスのURLを組み立てる', () => {
    expect(redirectUriFromRequestUrl('https://app.example/api/notion/oauth/callback?code=c1&state=st')).toBe(
      'https://app.example' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })

  it('大文字ホスト・既定ポートも正規化される（new URL()を通すため）', () => {
    expect(redirectUriFromRequestUrl('https://APP.EXAMPLE:443/api/notion/oauth/callback?code=c1')).toBe(
      'https://app.example' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })

  it('requestUrl が http でも x-forwarded-proto: https を渡せばそちらが勝つ（TLS終端プロキシ配下）', () => {
    expect(
      redirectUriFromRequestUrl('http://app.example/api/notion/oauth/callback?code=c1', 'https'),
    ).toBe('https://app.example' + NOTION_OAUTH_CALLBACK_PATH)
  })

  it('forwardedProto を渡さない・非ローカルホストなら guessProtocol と同じくhttpsへ倒す（是正後の挙動。requestUrlのスキームをそのまま信じない）', () => {
    expect(redirectUriFromRequestUrl('http://app.example/api/notion/oauth/callback?code=c1')).toBe(
      'https://app.example' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })

  it('forwardedProto を渡さない・ローカル/プライベートホストならhttpのまま（redirectUriFromHostと同じ判定）', () => {
    expect(redirectUriFromRequestUrl('http://192.168.1.42:3000/api/notion/oauth/callback?code=c1')).toBe(
      'http://192.168.1.42:3000' + NOTION_OAUTH_CALLBACK_PATH,
    )
  })
})

describe('redirectUriFromRequestUrl と redirectUriFromHost の一致', () => {
  it('同一オリジンなら両方の組み立て方が完全に同じ文字列になる', () => {
    const fromHeader = redirectUriFromHost({ host: 'app.example', forwardedProto: 'https' })
    const fromReqUrl = redirectUriFromRequestUrl('https://app.example/api/notion/oauth/callback?code=c1&state=st')
    expect(fromHeader).toBe(fromReqUrl)
  })

  it('LANのローカルIPでも一致する（forwardedProto無し・http想定）', () => {
    const fromHeader = redirectUriFromHost({ host: '192.168.1.42:3000' })
    const fromReqUrl = redirectUriFromRequestUrl('http://192.168.1.42:3000/api/notion/oauth/callback?code=c1')
    expect(fromHeader).toBe(fromReqUrl)
  })

  it('TLS終端プロキシ配下（着信は http だが外部スキームは https）でも、同じ forwardedProto を渡せば一致する', () => {
    const fromHeader = redirectUriFromHost({ host: 'app.example', forwardedProto: 'https' })
    const fromReqUrl = redirectUriFromRequestUrl(
      'http://app.example/api/notion/oauth/callback?code=c1&state=st',
      'https',
    )
    expect(fromHeader).toBe(fromReqUrl)
  })

  // Finding（Minor）: x-forwarded-proto を送らないTLS終端プロキシ配下では、
  // 以前は /connect/notion（headers()経由・forwardedProto無し→非ローカルなのでhttpsを推測）と
  // callback（req.url由来・着信のままhttpを維持）が食い違い、Notionの交換がすべて失敗していた。
  // ここでその一致を固定する（forwardedProtoを渡さない・非ローカルホストのケース）。
  it('forwardedProto無し・非ローカルホストでも一致する（ヘッダーを送らないプロキシ配下でのフォールバック整合）', () => {
    const fromHeader = redirectUriFromHost({ host: 'app.example' })
    const fromReqUrl = redirectUriFromRequestUrl('http://app.example/api/notion/oauth/callback?code=c1&state=st')
    expect(fromHeader).toBe(fromReqUrl)
    expect(fromHeader).toBe('https://app.example' + NOTION_OAUTH_CALLBACK_PATH)
  })
})
