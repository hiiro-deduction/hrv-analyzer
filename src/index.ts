export interface Env {}

// 中央値を計算する関数
function getMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  
  if (sorted.length % 2 === 0) {
    return (sorted[half - 1] + sorted[half]) / 2.0;
  }
  return sorted[half];
}

// 平均値を計算する関数
function getMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// 標準偏差を計算する関数
function getStandardDeviation(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const squareDiffs = values.map((value) => {
    const diff = value - mean;
    return diff * diff;
  });
  const avgSquareDiff = getMean(squareDiffs);
  return Math.sqrt(avgSquareDiff);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 1. POSTメソッド以外は弾く (セキュリティ対策)
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      // 2. iPhone(ショートカット)から送られてきたJSONを取得
      const data = await request.json<any>();
      
      // --- ここに、送られてきた改行区切りのデータをパース(変換)する処理を書きます ---
      // 例: const hrvDateArray = data.hrv.hrv_dates.split('\n');
      
      // 3. テスト用の仮レスポンス
      return Response.json({
        message: "データを受信しました！",
        receivedDataKeys: Object.keys(data) 
      });

    } catch (error) {
      return new Response("Invalid JSON format", { status: 400 });
    }
  },
};