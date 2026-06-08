import { describe, it, expect } from "vitest";
import { formatConditionData } from "../../src/core/formatter";

describe("formatConditionData", () => {
  it("正常なメトリクスからテキストを構築する", () => {
    const metrics = {
      hrv: { baseline_median: 40, baseline_stddev: 5, today: 45 },
      rhr: { baseline_mean: 60, today: 58 },
      respiratory_rate: { baseline_mean: 15, today: 15 },
      sleep: { baseline_mean_hours: 7, baseline_deep_percentage: 25, today_hours: 8, today_deep_percentage: 20 }
    };
    const { condition_text, system_warnings } = formatConditionData(metrics);
    expect(condition_text).toContain("心拍変動(HRV): 45.0");
    expect(condition_text).toContain("安静時心拍数(RHR): 58.0");
    expect(condition_text).toContain("睡眠時間: 8.0時間");
    expect(condition_text).toContain("深い睡眠の割合: 20.0%");
    expect(system_warnings.length).toBe(0);
  });

  it("データ不足(null)の場合「データ同期中」となる", () => {
    const metrics = {
      hrv: { baseline_median: 0, baseline_stddev: 0, today: null },
      rhr: { baseline_mean: 0, today: null },
      respiratory_rate: { baseline_mean: 0, today: null },
      sleep: { baseline_mean_hours: 0, baseline_deep_percentage: null, today_hours: null, today_deep_percentage: null }
    };
    const { condition_text, system_warnings } = formatConditionData(metrics);
    expect(condition_text).toContain("心拍変動(HRV): データ同期中");
    expect(condition_text).toContain("睡眠時間: データ同期中");
    expect(condition_text).toContain("深い睡眠の割合: データ同期中");
    expect(system_warnings.length).toBe(0);
  });

  it("睡眠時間が短く深い睡眠割合が低い場合はシステム警告テキストが含まれる", () => {
    const metrics = {
      hrv: { baseline_median: 40, baseline_stddev: 5, today: 45 },
      rhr: { baseline_mean: 60, today: 58 },
      respiratory_rate: { baseline_mean: 15, today: 15 },
      sleep: { baseline_mean_hours: 7, baseline_deep_percentage: 25, today_hours: 2, today_deep_percentage: 10 }
    };
    const { condition_text, system_warnings } = formatConditionData(metrics);
    expect(system_warnings.length).toBe(2);
    expect(system_warnings[0]).toContain("3時間未満の危険域");
    expect(system_warnings[1]).toContain("15%を下回っています");
    
    // condition_textの末尾に警告が「警告：」というプレフィックス付きで結合されていることを確認
    expect(condition_text).toContain("※【システム警告】");
    expect(condition_text).toContain("・警告：本日の睡眠時間が3時間未満の危険域です。");
    expect(condition_text).toContain("・警告：本日の深い睡眠の割合が15%を下回っています。");
  });
});
