import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { analyzeHealthData, AnalysisError, formatConditionData } from "../../src/core/analysis";

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

  it("正常なデータから各種メトリクスとコンディションテキストが生成される", () => {
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
    expect(result).toHaveProperty('condition_text');
    expect(result.metrics.hrv.today).toBe(40);
    expect(result.metrics.hrv.baseline_median).toBe(30);
    expect(result.condition_text).toContain("【本日の体調データ】");
  });
});

describe("formatConditionData", () => {
  it("正常なメトリクスからテキストを構築する", () => {
    const metrics = {
      hrv: { baseline_median: 40, baseline_stddev: 5, today: 45 },
      rhr: { baseline_mean: 60, today: 58 },
      respiratory_rate: { baseline_mean: 15, today: 15 },
      sleep: { baseline_mean_hours: 7, baseline_deep_percentage: 25, today_hours: 8, today_deep_percentage: 20 }
    };
    const prompt = formatConditionData(metrics);
    expect(prompt).toContain("心拍変動(HRV): 45.0");
    expect(prompt).toContain("安静時心拍数(RHR): 58.0");
    expect(prompt).toContain("睡眠時間: 8.0時間");
    expect(prompt).toContain("深い睡眠の割合: 20.0%");
  });

  it("データ不足(null)の場合「データ同期中」となる", () => {
    const metrics = {
      hrv: { baseline_median: 0, baseline_stddev: 0, today: null },
      rhr: { baseline_mean: 0, today: null },
      respiratory_rate: { baseline_mean: 0, today: null },
      sleep: { baseline_mean_hours: 0, baseline_deep_percentage: null, today_hours: null, today_deep_percentage: null }
    };
    const prompt = formatConditionData(metrics);
    expect(prompt).toContain("心拍変動(HRV): データ同期中");
    expect(prompt).toContain("睡眠時間: データ同期中");
    expect(prompt).toContain("深い睡眠の割合: データ同期中");
  });

  it("睡眠時間が短く深い睡眠割合が低い場合はシステム警告テキストが含まれる", () => {
    const metrics = {
      hrv: { baseline_median: 40, baseline_stddev: 5, today: 45 },
      rhr: { baseline_mean: 60, today: 58 },
      respiratory_rate: { baseline_mean: 15, today: 15 },
      sleep: { baseline_mean_hours: 7, baseline_deep_percentage: 25, today_hours: 2, today_deep_percentage: 10 }
    };
    const prompt = formatConditionData(metrics);
    // 元々「システム警告は含まれない」というテストだったが、現在は10%や2時間の場合は「システム警告」を含む仕様になった。
    // そのためテストの意図を変えて、システム警告が含まれることを確認するテストにする
    expect(prompt).toContain("システム警告");
  });
});
