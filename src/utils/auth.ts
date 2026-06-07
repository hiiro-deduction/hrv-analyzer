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
    const a = encoder.encode(provided);
    const b = encoder.encode(expected);
    // 長さが異なる場合は expected 同士を比較して時間を消費する
    const dummyResult = timingSafeEqual(b, b);
    void dummyResult;
    return false;
  }

  const encoder = new TextEncoder();
  const a = encoder.encode(provided);
  const b = encoder.encode(expected);
  return timingSafeEqual(a, b);
}

/**
 * 固定時間でバイト列を比較する（タイミング攻撃防止）
 * @param a 比較するバイト列
 * @param b 比較するバイト列
 * @returns バイト列が完全に一致する場合はtrue
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
