export interface Env {
  // シークレット（wrangler secret put で設定、ローカル開発時は .dev.vars に記載）
  GEMINI_API_KEY?: string;
  DISCORD_WEBHOOK_URL?: string;
  API_SECRET_TOKEN?: string;
}

// iOSショートカットから送信されるヘルスケアデータの型定義
export interface HealthDataPayload {
  hrv?: {
    hrv_dates: string;
    hrv_value: string;
  };
  sleep?: {
    sleep_start_dates: string;
    sleep_end_dates: string;
    sleep_value: string;
  };
  rhr?: {
    rhr_dates: string;
    rhr_value: string;
  };
}

// データ分析結果の型定義
export interface AnalysisResult {
  metrics: {
    hrv: {
      baseline_median: number;
      baseline_stddev: number;
      today: number | null;
    };
    rhr: {
      baseline_mean: number;
      today: number | null;
    };
    sleep: {
      baseline_mean_hours: number;
      today_hours: number | null;
    };
  };
  prompt_context: string;
}

// --- 定数 ---
const VALID_SLEEP_STAGES = new Set(['core', 'deep', 'rem', 'asleep']);

// Gemini APIのエンドポイント
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent';

// --- ユーティリティ関数 ---
/**
 * 平均値を計算する関数
 * @param values 計算対象の数値配列
 * @returns 平均値
 */
export function getMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * 中央値を計算する関数
 * @param values 計算対象の数値配列
 * @returns 中央値
 */
export function getMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  
  if (sorted.length % 2 === 0) {
    return (sorted[half - 1] + sorted[half]) / 2.0;
  }
  return sorted[half];
}

/**
 * 標準偏差を計算する関数
 * @param values 計算対象の数値配列
 * @param mean 平均値
 * @returns 標準偏差
 */
export function getStandardDeviation(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const squareDiffs = values.map((value) => {
    const diff = value - mean;
    return diff * diff;
  });
  const avgSquareDiff = getMean(squareDiffs);
  return Math.sqrt(avgSquareDiff);
}

export interface ParsedHealthData {
  start: Date;
  end?: Date;
  value: number | string;
}

/**
 * 日付文字列をパースし、タイムゾーン指定がない場合は日本時間(JST, +09:00)として扱う
 * iPhoneから送信されるデータにはタイムゾーン情報が含まれないための対策
 * @param dateStr 日付文字列 (例: "2026-06-04T00:00:28")
 * @returns Dateオブジェクト
 */
function parseDateWithJSTFallback(dateStr: string): Date {
  const cleanStr = dateStr.trim();
  if (!cleanStr) return new Date(NaN);

  const hasTimezone = cleanStr.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(cleanStr);
  return new Date(hasTimezone ? cleanStr : `${cleanStr}+09:00`);
}

// ショートカットから送られてくる改行区切りの文字列をパースしてオブジェクトの配列にする関数
export function parseShortcutData(dateStr?: string, valueStr?: string, endDateStr?: string): ParsedHealthData[] {
  if (!dateStr || !valueStr) return [];
  const dates = dateStr.trim().split(',');
  const values = valueStr.trim().split(',');
  const endDates = endDateStr ? endDateStr.trim().split(',') : null;

  return dates.map((date, index) => {
    let parsedValue: number | string = 0; // デフォルト値（欠損対策）
    if (values[index] !== undefined && values[index].trim() !== "") {
      const num = parseFloat(values[index]);
      parsedValue = !isNaN(num) ? num : values[index]; // 数値に変換できれば数値、できなければ文字列（Awake等）
    }

    const obj: ParsedHealthData = {
      // iPhoneからのデータには時差情報がないため、タイムゾーンを補完してパースする
      start: parseDateWithJSTFallback(date),
      value: parsedValue
    };
    if (endDates && endDates[index]) {
      obj.end = parseDateWithJSTFallback(endDates[index]);
    }
    return obj;
  }).filter(item => !isNaN(item.start.getTime())); // 無効な日付データ(空行など)を除外
}

// --- データ分析ロジック ---
/**
 * ヘルスケアデータの統計分析を行う
 * POST / と POST /notify の両方から共通で呼び出される
 * @param data iOSショートカットから送信されたペイロード
 * @returns 統計メトリクスとプロンプトコンテキストを含む分析結果
 */
export function analyzeHealthData(data: HealthDataPayload): AnalysisResult {
  // 1. データのパース（文字列から配列へ復元）
  const hrvData = parseShortcutData(data.hrv?.hrv_dates, data.hrv?.hrv_value);
  const rhrData = parseShortcutData(data.rhr?.rhr_dates, data.rhr?.rhr_value);
  const sleepData = parseShortcutData(data.sleep?.sleep_start_dates, data.sleep?.sleep_value, data.sleep?.sleep_end_dates);

  if (sleepData.length === 0) {
    throw new AnalysisError("No sleep data provided.", 400);
  }

  // 2. 睡眠時間の特定
  // Apple Healthの睡眠ステージのうち、InBed(就寝中)やAwake(覚醒)を除外し、明確に寝ているステージのみを抽出する
  const actualSleepPeriods = sleepData.filter(s => typeof s.value === 'string' && VALID_SLEEP_STAGES.has(s.value.toLowerCase()));

  // 3. 睡眠中のHRVとRHRのみを抽出する関数（計測タイミングのズレを考慮して前後5分のバッファを持たせる）
  const BUFFER_MS = 5 * 60 * 1000; // 5分
  const isDuringSleep = (date: Date) => {
    const time = date.getTime();
    return actualSleepPeriods.some(sleep => 
      sleep.end !== undefined &&
      (sleep.start.getTime() - BUFFER_MS) <= time && 
      (sleep.end.getTime() + BUFFER_MS) >= time
    );
  };

  // 4. ベースライン（過去）と今日（直近24時間）のデータを分割する
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));

  // HRVの分割と抽出（睡眠中のみ）
  const hrvBaseline = hrvData
    .filter(item => item.start < oneDayAgo && isDuringSleep(item.start))
    .map(item => Number(item.value));
  const hrvToday = hrvData
    .filter(item => item.start >= oneDayAgo && isDuringSleep(item.start))
    .map(item => Number(item.value));
  
  // RHRの分割と抽出（睡眠中のみ）
  const rhrBaseline = rhrData
    .filter(item => item.start < oneDayAgo && isDuringSleep(item.start))
    .map(item => Number(item.value));
  const rhrToday = rhrData
    .filter(item => item.start >= oneDayAgo && isDuringSleep(item.start))
    .map(item => Number(item.value));

  // 睡眠時間の計算（1日あたりの平均時間と、今日の合計時間）
  const baselineSleepPeriods = actualSleepPeriods.filter(item => item.start < oneDayAgo);
  const baselineSleepHoursTotal = baselineSleepPeriods.reduce((acc, s) => acc + (s.end ? (s.end.getTime() - s.start.getTime()) / (1000 * 60 * 60) : 0), 0);
  
  // 睡眠記録が存在する実日数を計算（夜をまたぐ睡眠を同一日として扱うため、12時間シフトして日付を判定）
  const uniqueSleepDays = new Set(baselineSleepPeriods.map(s => {
    const logicalDate = new Date(s.start.getTime() - 12 * 60 * 60 * 1000);
    return logicalDate.toISOString().split('T')[0];
  }));
  const sleepDaysCount = uniqueSleepDays.size > 0 ? uniqueSleepDays.size : 1; // 0除算防止
  const sleepBaselineMean = baselineSleepHoursTotal / sleepDaysCount;

  const sleepTodayPeriods = actualSleepPeriods.filter(item => item.start >= oneDayAgo);
  const sleepTodayTotal = sleepTodayPeriods.reduce((acc, s) => acc + (s.end ? (s.end.getTime() - s.start.getTime()) / (1000 * 60 * 60) : 0), 0);


  const isHrvMissing = hrvToday.length === 0;
  const isRhrMissing = rhrToday.length === 0;
  const isSleepMissing = sleepTodayPeriods.length === 0;

  // 今日のデータが存在しない場合はnullを返すようにし、AIやクライアントが誤って0として扱わないようにする
  const hrvTodayMean = isHrvMissing ? null : getMean(hrvToday);
  const rhrTodayMean = isRhrMissing ? null : getMean(rhrToday);
  const sleepTodayTotalHours = isSleepMissing ? null : sleepTodayTotal;

  // 5. 最終的な統計メトリクスの計算
  const metrics = {
    hrv: {
      baseline_median: getMedian(hrvBaseline),
      baseline_stddev: getStandardDeviation(hrvBaseline, getMean(hrvBaseline)),
      today: hrvTodayMean 
    },
    rhr: {
      baseline_mean: getMean(rhrBaseline),
      today: rhrTodayMean
    },
    sleep: {
      baseline_mean_hours: sleepBaselineMean,
      today_hours: sleepTodayTotalHours
    }
  };

  // 6. 状態判定ロジックとプロンプト用コンテキストの生成
  // データが存在する場合のみ判定ロジックを実行する（意味のない比較を防ぐ）
  
  let hrvStatus = "良好";
  if (hrvTodayMean !== null) {
    if (hrvTodayMean < (metrics.hrv.baseline_median - metrics.hrv.baseline_stddev)) {
      hrvStatus = "大きく低下（疲労あり）";
    } else if (hrvTodayMean < metrics.hrv.baseline_median) {
      hrvStatus = "やや低め";
    }
  }

  let rhrStatus = "標準的";
  if (rhrTodayMean !== null) {
    if (rhrTodayMean > metrics.rhr.baseline_mean + 3) {
      rhrStatus = "高め（負荷あり）";
    }
  }
  
  let sleepStatus = "標準的";
  if (sleepTodayTotalHours !== null) {
    if (sleepTodayTotalHours < 3) {
      sleepStatus = "非常に短い（危険）";
    } else if (sleepTodayTotalHours < metrics.sleep.baseline_mean_hours - 1) {
      sleepStatus = "短い";
    }
  }

  // 小数点第1位で丸めて出力します
  const formatHrv = hrvTodayMean === null 
    ? "データ同期中" 
    : `${hrvTodayMean.toFixed(1)} (平常時中央値${metrics.hrv.baseline_median.toFixed(1)}±${metrics.hrv.baseline_stddev.toFixed(1)}より${hrvStatus})`;

  const formatRhr = rhrTodayMean === null
    ? "データ同期中"
    : `${rhrTodayMean.toFixed(1)} (平常時平均${metrics.rhr.baseline_mean.toFixed(1)}より${rhrStatus})`;
    
  const formatSleep = sleepTodayTotalHours === null
    ? "データ同期中"
    : `${sleepTodayTotalHours.toFixed(1)}時間 (平常時${metrics.sleep.baseline_mean_hours.toFixed(1)}時間より${sleepStatus})`;

  // 警告メッセージの生成（睡眠が3時間未満の場合）
  const warningMessage = sleepTodayTotalHours !== null && sleepTodayTotalHours < 3
    ? "\n\n※【システム警告】本日の睡眠時間が3時間未満の危険域です。ポジティブな評価は絶対に避けてください。"
    : "";

  // プロンプト用のフォーマットで文字列を組み立てる
  const promptContext = `【本日の体調データ】
・心拍変動(HRV): ${formatHrv}
・安静時心拍数(RHR): ${formatRhr}
・睡眠時間: ${formatSleep}

上記は私の今日のコンディションデータです。${warningMessage}`;

  return { metrics, prompt_context: promptContext };
}

// --- 分析エラー ---
/**
 * データ分析中のエラーを表すカスタムエラークラス
 * HTTPステータスコードを保持する
 */
export class AnalysisError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'AnalysisError';
  }
}

// --- 外部API呼び出し ---
/**
 * Gemini APIを呼び出してヘルスデータに基づくアドバイスを取得する
 * @param promptContext analyzeHealthData() で生成されたプロンプトコンテキスト
 * @param apiKey Gemini API キー
 * @returns Geminiの応答テキスト
 */
export async function callGeminiAPI(promptContext: string, apiKey: string): Promise<string> {
  const userPrompt = `${promptContext}\n\nこれを踏まえて、今日の過ごし方のアドバイスを150文字以内で優しく教えてください。`;

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: userPrompt }] }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
  }

  const result = await response.json<{
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  }>();

  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini API returned no text content');
  }

  return text;
}

/**
 * Discord Webhookにメッセージを送信する
 * @param message 送信するメッセージ
 * @param webhookUrl Discord Webhook URL
 */
export async function sendDiscordNotification(message: string, webhookUrl: string): Promise<void> {
  // Discordのメッセージ上限は2000文字
  const truncatedMessage = message.length > 2000
    ? message.slice(0, 1997) + '...'
    : message;

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: truncatedMessage }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Discord Webhook error (${response.status}): ${errorBody}`);
  }
}

// --- 認証ヘルパー ---
/**
 * タイミング安全なトークン比較を行う
 * タイミング攻撃を防ぐため、固定時間で比較する
 * @param provided リクエストから取得したトークン
 * @param expected 設定されたシークレットトークン
 * @returns トークンが一致するかどうか
 */
function secureCompare(provided: string, expected: string): boolean {
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
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

// --- バックグラウンド処理 ---
/**
 * バックグラウンドで Gemini API → Discord Webhook の一連の処理を実行する
 * ctx.waitUntil() から呼び出される
 * @param promptContext 分析結果のプロンプトコンテキスト
 * @param env 環境変数
 */
async function processNotificationInBackground(promptContext: string, env: Env): Promise<void> {
  try {
    // Gemini APIでアドバイスを取得
    const advice = await callGeminiAPI(promptContext, env.GEMINI_API_KEY!);
    
    // Discord にプロンプトコンテキスト（体調データ）とアドバイスを送信
    const discordMessage = `${promptContext}\n\n🤖 **AIアドバイス:**\n${advice}`;
    await sendDiscordNotification(discordMessage, env.DISCORD_WEBHOOK_URL!);
    
    console.log('バックグラウンド処理完了: Gemini → Discord 通知成功');
  } catch (error) {
    // バックグラウンド処理のエラーはログに記録する（クライアントには既にレスポンス済み）
    console.error('バックグラウンド処理エラー:', error);
  }
}

// --- メインハンドラ ---
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);

    // ルーティング: パスに応じて処理を分岐
    switch (url.pathname) {
      case '/':
        return handleAnalyze(request);
      case '/notify':
        return handleNotify(request, env, ctx);
      default:
        return new Response("Not Found", { status: 404 });
    }
  },
};

// --- ルートハンドラ ---

/**
 * POST / — 既存のデータ分析エンドポイント（後方互換性を維持）
 * 認証不要。JSON で統計データとプロンプトを返す。
 */
async function handleAnalyze(request: Request): Promise<Response> {
  let data: HealthDataPayload;
  try {
    data = await request.json<HealthDataPayload>();
  } catch {
    return Response.json({ error: "Invalid JSON format" }, { status: 400 });
  }

  try {
    const result = analyzeHealthData(data);
    return Response.json(result);
  } catch (error) {
    if (error instanceof AnalysisError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("Internal Server Error:", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

/**
 * POST /notify — 認証付き非同期通知エンドポイント
 * iOSショートカットからのリクエストを受け、即座にレスポンスを返す。
 * バックグラウンドで Gemini API → Discord Webhook の処理を実行する。
 */
async function handleNotify(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // シークレットが設定されているか確認
  if (!env.API_SECRET_TOKEN || !env.GEMINI_API_KEY || !env.DISCORD_WEBHOOK_URL) {
    console.error('必要なシークレットが設定されていません');
    return Response.json(
      { error: "Service not configured" },
      { status: 503 }
    );
  }

  // Bearer トークンによる認証
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice('Bearer '.length);
  if (!secureCompare(token, env.API_SECRET_TOKEN)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // リクエストボディのパース
  let data: HealthDataPayload;
  try {
    data = await request.json<HealthDataPayload>();
  } catch {
    return Response.json({ error: "Invalid JSON format" }, { status: 400 });
  }

  // データ分析を即座に実行（バリデーションエラーはこの時点で返す）
  let result: AnalysisResult;
  try {
    result = analyzeHealthData(data);
  } catch (error) {
    if (error instanceof AnalysisError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("Analysis Error:", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }

  // バックグラウンドで Gemini → Discord 処理を起動
  ctx.waitUntil(processNotificationInBackground(result.prompt_context, env));

  // iOSショートカットには即座にレスポンスを返す
  return Response.json(
    { status: "accepted", message: "データを受け取りました！バックグラウンドで処理中です。" },
    { status: 202 }
  );
}