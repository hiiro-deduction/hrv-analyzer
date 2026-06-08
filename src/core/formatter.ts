import { AnalysisResult } from '../types';
import { CRITICAL_SLEEP_HOURS } from './analysis';

export interface FormattedCondition {
  condition_text: string;
  system_warnings: string[];
}

/**
 * 体調データのメトリクスを人が読めるテキストにフォーマットし、システム警告を抽出する
 * @param metrics 計算済みのメトリクス
 * @returns フォーマットされたテキストとシステム警告の配列
 */
export function formatConditionData(metrics: AnalysisResult['metrics']): FormattedCondition {
  let hrvStatus = "標準的";
  if (metrics.hrv.today !== null) {
    if (metrics.hrv.today < (metrics.hrv.baseline_median - metrics.hrv.baseline_stddev)) {
      hrvStatus = "大きく低下（強い疲労）";
    } else if (metrics.hrv.today < metrics.hrv.baseline_median) {
      hrvStatus = "やや低め";
    }
  }

  let rhrStatus = "標準的";
  if (metrics.rhr.today !== null) {
    if (metrics.rhr.today > metrics.rhr.baseline_mean + 3) {
      rhrStatus = "高め（負荷あり）";
    }
  }

  let rrStatus = "標準的";
  if (metrics.respiratory_rate.today !== null) {
    if (metrics.respiratory_rate.today > metrics.respiratory_rate.baseline_mean + 1.5) {
      rrStatus = "多い（体調不良の兆候）";
    }
  }
  
  let sleepStatus = "標準的";
  const systemWarnings: string[] = [];
  
  if (metrics.sleep.today_hours !== null) {
    if (metrics.sleep.today_hours < CRITICAL_SLEEP_HOURS) {
      sleepStatus = "非常に短い（システム警告）";
      systemWarnings.push("本日の睡眠時間が3時間未満の危険域です。");
    } else if (metrics.sleep.today_hours < metrics.sleep.baseline_mean_hours - 1) {
      sleepStatus = "短い";
    }
  }

  let deepSleepStatus = "標準的";
  if (metrics.sleep.today_deep_percentage !== null) {
    if (metrics.sleep.today_deep_percentage < 15) {
      deepSleepStatus = "質が低下（システム警告）";
      systemWarnings.push("本日の深い睡眠の割合が15%を下回っています。");
    } else if (metrics.sleep.baseline_deep_percentage !== null && metrics.sleep.today_deep_percentage < metrics.sleep.baseline_deep_percentage - 5) {
      deepSleepStatus = "普段より質が低下";
      // ※ AIプロンプトの指示で、普段より質が低下(5%以上低下)した場合も強い警告とみなす
      systemWarnings.push("本日の深い睡眠の割合が普段の平均より5%以上低下しています。");
    }
  }

  if (metrics.respiratory_rate.today !== null && metrics.respiratory_rate.today > metrics.respiratory_rate.baseline_mean + 1.5) {
      // 呼吸数が直近7日平均より1.5回/分以上多い場合もサバイバルモードのトリガーとするため警告に追加
      systemWarnings.push("呼吸数が直近7日平均より大きく上昇しており、強い体調不良の兆候があります。");
  }

  const formatHrv = metrics.hrv.today === null 
    ? "データ同期中" 
    : `${metrics.hrv.today.toFixed(1)} (平常時中央値${metrics.hrv.baseline_median.toFixed(1)}±${metrics.hrv.baseline_stddev.toFixed(1)}より${hrvStatus})`;

  const formatRhr = metrics.rhr.today === null
    ? "データ同期中"
    : `${metrics.rhr.today.toFixed(1)} (平常時平均${metrics.rhr.baseline_mean.toFixed(1)}より${rhrStatus})`;
    
  const formatRr = metrics.respiratory_rate.today === null
    ? "データ同期中"
    : `${metrics.respiratory_rate.today.toFixed(1)}回/分 (平常時平均${metrics.respiratory_rate.baseline_mean.toFixed(1)}より${rrStatus})`;

  const formatSleep = metrics.sleep.today_hours === null
    ? "データ同期中"
    : `${metrics.sleep.today_hours.toFixed(1)}時間 (平常時${metrics.sleep.baseline_mean_hours.toFixed(1)}時間より${sleepStatus})`;

  const formatDeepSleep = metrics.sleep.today_deep_percentage === null
    ? "データ同期中"
    : `${metrics.sleep.today_deep_percentage.toFixed(1)}% (${deepSleepStatus})`;

  const condition_text = `【本日の体調データ】
・心拍変動(HRV): ${formatHrv}
・安静時心拍数(RHR): ${formatRhr}
・呼吸数: ${formatRr}
・睡眠時間: ${formatSleep}
・深い睡眠の割合: ${formatDeepSleep}`;

  return { condition_text, system_warnings: systemWarnings };
}
