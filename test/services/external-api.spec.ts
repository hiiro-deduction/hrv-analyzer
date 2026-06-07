import { describe, it, expect, vi, afterEach } from "vitest";
import { callGeminiAPI, sendDiscordNotification, buildGeminiPrompt } from "../../src/services/external-api";
import { AnalysisResult } from "../../src/types";

describe("Services: external-api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("callGeminiAPI", () => {
    it("正常にGemini APIを呼び出してテキストを返す", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "テストアドバイス" }] } }]
        })
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

      const result = await callGeminiAPI("プロンプト", "dummy-key");
      expect(result).toBe("テストアドバイス");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=dummy-key",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("APIがエラーを返した場合、例外をスローする", async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        text: async () => "Bad Request"
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

      await expect(callGeminiAPI("プロンプト", "dummy-key")).rejects.toThrow("Gemini API error (400): Bad Request");
    });

    it("レスポンスにテキストが含まれない場合、例外をスローする", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ candidates: [] })
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

      await expect(callGeminiAPI("プロンプト", "dummy-key")).rejects.toThrow("Gemini API returned no text content");
    });
  });

  describe("sendDiscordNotification", () => {
    it("正常にDiscordにメッセージを送信する", async () => {
      const mockResponse = { ok: true };
      global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

      await sendDiscordNotification("テストメッセージ", "https://discord.com/api/webhooks/test");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://discord.com/api/webhooks/test",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ content: "テストメッセージ" })
        })
      );
    });

    it("2000文字を超えるメッセージはトランケートされる", async () => {
      const mockResponse = { ok: true };
      global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

      const longMessage = "a".repeat(2500);
      await sendDiscordNotification(longMessage, "https://discord.com/api/webhooks/test");

      const calledWith = vi.mocked(global.fetch).mock.calls[0][1];
      const body = JSON.parse(calledWith?.body as string);
      expect(body.content.length).toBe(2000); // 1997 + '...' = 2000
      expect(body.content.endsWith("...")).toBe(true);
    });

    it("APIがエラーを返した場合、例外をスローする", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: async () => "Internal Server Error"
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

      await expect(sendDiscordNotification("msg", "webhook")).rejects.toThrow("Discord Webhook error (500): Internal Server Error");
    });
  });

  describe("buildGeminiPrompt", () => {
    const baseMetrics = {
      hrv: { baseline_median: 40, baseline_stddev: 5, today: 40 },
      rhr: { baseline_mean: 60, today: 60 },
      respiratory_rate: { baseline_mean: 15, today: 15 },
      sleep: { baseline_mean_hours: 7, today_hours: 7, today_deep_percentage: 20 }
    };
    const baseResult: AnalysisResult = {
      metrics: baseMetrics,
      condition_text: "テストコンディション"
    };

    it("正常なデータの場合、警告メッセージは空でプロンプトが生成される", () => {
      const { discordWarning, geminiPrompt } = buildGeminiPrompt(baseResult);
      expect(discordWarning).toBe("");
      expect(geminiPrompt).toContain("テストコンディション");
      expect(geminiPrompt).toContain("今日の過ごし方のアドバイス");
      expect(geminiPrompt).not.toContain("システム警告");
    });

    it("睡眠時間が3時間未満の場合、警告が追加される", () => {
      const result = {
        ...baseResult,
        metrics: {
          ...baseResult.metrics,
          sleep: { ...baseResult.metrics.sleep, today_hours: 2 }
        }
      };
      const { discordWarning, geminiPrompt } = buildGeminiPrompt(result);
      expect(discordWarning).toContain("睡眠時間が3時間未満の危険域");
      expect(geminiPrompt).toContain("睡眠時間が3時間未満の危険域");
    });

    it("深い睡眠が15%未満の場合、警告が追加される", () => {
      const result = {
        ...baseResult,
        metrics: {
          ...baseResult.metrics,
          sleep: { ...baseResult.metrics.sleep, today_deep_percentage: 10 }
        }
      };
      const { discordWarning, geminiPrompt } = buildGeminiPrompt(result);
      expect(discordWarning).toContain("深い睡眠の割合が15%を下回っています");
      expect(geminiPrompt).toContain("深い睡眠の割合が15%を下回っています");
    });
  });
});
