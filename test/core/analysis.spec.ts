import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { analyzeHealthData, AnalysisError, buildPromptContext } from "../../src/core/analysis";

describe("analyzeHealthData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("睡眠データが空の場合、AnalysisErrorをスローする", () => {
    const data = {
      hrv: { hrv_dates: "2026-06-01T00:00:00Z", hrv_value: "30" }
    };
    expect(() => analyzeHealthData(data)).toThrow(AnalysisError);
    expect(() => analyzeHealthData(data)).toThrow("No sleep data provided.");
  });

  it("正常なデータで分析結果が正しい構造を持つ", () => {
    const data = {
      hrv: { hrv_dates: "2026-06-01T00:00:00Z,2026-06-04T00:00:00Z", hrv_value: "30.0,40.0" },
      rhr: { rhr_dates: "2026-06-01T00:00:00Z,2026-06-04T00:00:00Z", rhr_value: "60.0,65.0" },
      sleep: {
        sleep_start_dates: "2026-06-01T00:00:00Z,2026-06-04T00:00:00Z",
        sleep_end_dates: "2026-06-01T06:00:00Z,2026-06-04T06:00:00Z",
        sleep_value: "Core,Core"
      }
    };
    const result = analyzeHealthData(data);
    expect(result).toHaveProperty('metrics');
    expect(result).toHaveProperty('prompt_context');
    expect(result.metrics.hrv).toHaveProperty('baseline_median');
    expect(result.metrics.hrv).toHaveProperty('baseline_stddev');
    expect(result.metrics.hrv).toHaveProperty('today');
    expect(result.prompt_context).toContain("【本日の体調データ】");
  });
});

describe("buildPromptContext", () => {
  it("睡眠時間が3時間未満の場合、システム警告が含まれる", () => {
    const metrics = {
      hrv: { baseline_median: 30, baseline_stddev: 5, today: 40 },
      rhr: { baseline_mean: 60, today: 60 },
      sleep: { baseline_mean_hours: 6, today_hours: 2.5, today_deep_percentage: 20 }
    };
    const prompt = buildPromptContext(metrics);
    expect(prompt).toContain("睡眠時間: 2.5時間 (平常時6.0時間より非常に短い（危険）)");
    expect(prompt).toContain("※【システム警告】本日の睡眠時間が3時間未満の危険域です");
  });

  it("深い睡眠の割合が15%未満の場合、システム警告が含まれる", () => {
    const metrics = {
      hrv: { baseline_median: 30, baseline_stddev: 5, today: 40 },
      rhr: { baseline_mean: 60, today: 60 },
      sleep: { baseline_mean_hours: 6, today_hours: 7, today_deep_percentage: 10 }
    };
    const prompt = buildPromptContext(metrics);
    expect(prompt).toContain("※【システム警告】本日の深い睡眠の割合が15%を下回っています");
  });

  it("今日未測定のデータ（null）がある場合、データ同期中と表示される", () => {
    const metrics = {
      hrv: { baseline_median: 30, baseline_stddev: 5, today: null },
      rhr: { baseline_mean: 60, today: null },
      sleep: { baseline_mean_hours: 6, today_hours: null, today_deep_percentage: null }
    };
    const prompt = buildPromptContext(metrics);
    expect(prompt).toContain("心拍変動(HRV): データ同期中");
    expect(prompt).toContain("安静時心拍数(RHR): データ同期中");
    expect(prompt).toContain("睡眠時間: データ同期中");
    expect(prompt).toContain("深い睡眠の割合: データ同期中");
  });
});
