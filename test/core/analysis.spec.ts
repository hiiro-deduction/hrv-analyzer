import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { analyzeHealthData, AnalysisError } from "../../src/core/analysis";

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

