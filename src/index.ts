import { Env, HealthDataPayload, AnalysisResult } from './types';
import { analyzeHealthData, AnalysisError } from './core/analysis';
import { callGeminiAPI, sendDiscordNotification } from './services/external-api';
import { secureCompare } from './utils/auth';

/**
 * バックグラウンドで非同期実行される通知プロセス
 * @param analysisResult 分析結果
 * @param env 環境変数
 */
async function processNotificationInBackground(analysisResult: AnalysisResult, env: Env): Promise<void> {
  try {
    const metrics = analysisResult.metrics;
    
    // システム警告の生成
    const warningMessage = metrics.sleep.today_hours !== null && metrics.sleep.today_hours < 3
      ? "\n\n※【システム警告】本日の睡眠時間が3時間未満の危険域です。"
      : "";
    const deepSleepWarning = metrics.sleep.today_deep_percentage !== null && metrics.sleep.today_deep_percentage < 15
      ? "\n\n※【システム警告】本日の深い睡眠の割合が15%を下回っています。"
      : "";

    // LLMに渡す最終的なプロンプトを構築
    const userPrompt = `${analysisResult.condition_text}

上記は私の今日のコンディションデータです。${warningMessage}${deepSleepWarning}

これを踏まえて、今日の過ごし方のアドバイスを200文字以内で優しく教えてください。
冒頭は「おはようございます」など挨拶から始めてください。`;

    // Gemini APIでアドバイスを取得
    const advice = await callGeminiAPI(userPrompt, env.GEMINI_API_KEY!);
    
    // Discord にコンディションテキストとアドバイスを送信
    const discordMessage = `${analysisResult.condition_text}\n\n**AIアドバイス:**\n${advice}`;
    await sendDiscordNotification(discordMessage, env.DISCORD_WEBHOOK_URL!);
    
    console.log('バックグラウンド処理完了: Gemini → Discord 通知成功');
  } catch (error) {
    // バックグラウンド処理のエラーはログに記録する（クライアントには既にレスポンス済み）
    console.error('バックグラウンド処理エラー:', error);
  }
}

/**
 * POST / — 既存のデータ分析エンドポイント（後方互換性を維持）
 * 認証不要。JSON で統計データとプロンプトを返す。
 * @param request HTTPリクエスト
 * @returns JSON形式の分析結果を含むレスポンス
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
 * @param request HTTPリクエスト
 * @param env 環境変数
 * @param ctx 実行コンテキスト（バックグラウンド処理に使用）
 * @returns 受付完了を示すレスポンス
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

  // バックグラウンドで非同期実行
  ctx.waitUntil(processNotificationInBackground(result, env));

  // iOSショートカットには即座にレスポンスを返す
  return Response.json(
    { status: "accepted", message: "データを受け取りました！バックグラウンドで処理中です。" },
    { status: 202 }
  );
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