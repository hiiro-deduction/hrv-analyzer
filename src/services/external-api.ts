// Gemini APIのエンドポイント
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

/**
 * Gemini APIを呼び出してヘルスデータに基づくアドバイスを取得する
 * @param promptContext analyzeHealthData() で生成されたプロンプトコンテキスト
 * @param apiKey Gemini API キー
 * @returns Geminiの応答テキスト
 */
export async function callGeminiAPI(promptContext: string, apiKey: string): Promise<string> {
  const userPrompt = `${promptContext}\n\nこれを踏まえて、今日の過ごし方のアドバイスを200文字以内で優しく教えてください。
  冒頭は「おはようございます」など挨拶から始めてください。`;

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
