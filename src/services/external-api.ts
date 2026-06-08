// Gemini APIのエンドポイント
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

import { AnalysisResult } from '../types';

/**
 * Gemini APIを呼び出してテキストを生成する
 * @param prompt APIに送信するプロンプト文字列
 * @param apiKey Gemini API キー
 * @returns Geminiの応答テキスト
 */
export async function callGeminiAPI(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
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

/**
 * 分析結果からGemini APIに送信するプロンプトとシステム警告を生成する
 * @param analysisResult 分析結果
 * @returns [Discordに送信するシステム警告のテキスト, Geminiに送信するプロンプト] のオブジェクト
 */
export function buildGeminiPrompt(analysisResult: AnalysisResult): { discordWarning: string, geminiPrompt: string } {
  let discordWarning = "";
  
  // システム警告の生成（analysis.tsのフォーマッターで生成された警告配列を使用）
  let warningMessage = "";
  if (analysisResult.system_warnings && analysisResult.system_warnings.length > 0) {
    warningMessage = "\n\n※【システム警告】\n" + analysisResult.system_warnings.map(w => "・" + w).join("\n");
    discordWarning = warningMessage;
  }

  // LLMに渡す最終的なプロンプトを構築
  const geminiPrompt = `${analysisResult.condition_text}

上記は私の今日のコンディションデータです。${warningMessage}

これを踏まえて、今日の過ごし方のアドバイスを200文字以内で優しく教えてください。
冒頭は「おはようございます」など挨拶から始めてください。`;

  return { discordWarning, geminiPrompt };
}
