/**
 * タイミング安全なトークン比較を行う
 * タイミング攻撃を防ぐため、固定時間で比較する
 * @param provided リクエストから取得したトークン
 * @param expected 設定されたシークレットトークン
 * @returns トークンが一致するかどうか
 */
export function secureCompare(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) {
    // 長さが異なっても、固定時間の比較を行ってタイミングリークを防ぐ
    const encoder = new TextEncoder();
    const b = encoder.encode(expected);
    // 長さが異なる場合は expected 同士を比較して時間を消費する
    const dummyResult = crypto.subtle.timingSafeEqual(b, b);
    void dummyResult;
    return false;
  }

  const encoder = new TextEncoder();
  const a = encoder.encode(provided);
  const b = encoder.encode(expected);
  return crypto.subtle.timingSafeEqual(a, b);
}
