import { HealthDataPayload, AnalysisResult } from '../types';
import { parseShortcutData, calculateTotalHours } from '../utils/parser';
import { getMean, getMedian, getStandardDeviation } from '../utils/stats';

// --- 定数 ---
const VALID_SLEEP_STAGES = new Set(['core', 'deep', 'rem', 'asleep']);

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

/**
 * ヘルスケアデータの統計メトリクスを計算する（プロンプト生成は含まない）
 * @param data iOSショートカットから送信されたペイロード
 * @returns 統計メトリクス
 */
export function calculateHealthMetrics(data: HealthDataPayload): AnalysisResult['metrics'] {
  // 1. データのパース（文字列から配列へ復元）
  const hrvData = parseShortcutData(data.hrv?.hrv_dates, data.hrv?.hrv_value);
  const rhrData = parseShortcutData(data.rhr?.rhr_dates, data.rhr?.rhr_value);
  const sleepData = parseShortcutData(data.sleep?.sleep_start_dates, data.sleep?.sleep_value, data.sleep?.sleep_end_dates);

  if (sleepData.length === 0) {
    throw new AnalysisError("No sleep data provided.", 400);
  }

  // 2. 睡眠時間の特定
  const actualSleepPeriods = sleepData.filter(s => typeof s.value === 'string' && VALID_SLEEP_STAGES.has(s.value.toLowerCase()));

  // 3. 睡眠中のHRVとRHRのみを抽出する関数
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
  const twoDaysAgo = new Date(now.getTime() - (48 * 60 * 60 * 1000));

  const hrvBaseline = hrvData
    .filter(item => item.start < oneDayAgo && isDuringSleep(item.start))
    .map(item => Number(item.value));
  const hrvToday = hrvData
    .filter(item => item.start >= oneDayAgo && isDuringSleep(item.start))
    .map(item => Number(item.value));
  
  const rhrBaseline = rhrData
    .filter(item => item.start < twoDaysAgo)
    .map(item => Number(item.value));
  const rhrRecent = rhrData
    .filter(item => item.start >= twoDaysAgo)
    .map(item => Number(item.value));

  const baselineSleepPeriods = actualSleepPeriods.filter(item => item.start < oneDayAgo);
  const baselineSleepHoursTotal = calculateTotalHours(baselineSleepPeriods);
  
  const uniqueSleepDays = new Set(baselineSleepPeriods.map(s => {
    const logicalDate = new Date(s.start.getTime() - 12 * 60 * 60 * 1000);
    return logicalDate.toISOString().split('T')[0];
  }));
  const sleepDaysCount = uniqueSleepDays.size > 0 ? uniqueSleepDays.size : 1; 
  const sleepBaselineMean = baselineSleepHoursTotal / sleepDaysCount;

  const sleepTodayPeriods = actualSleepPeriods.filter(item => item.start >= oneDayAgo);
  const sleepTodayTotal = calculateTotalHours(sleepTodayPeriods);
  const sleepTodayDeepPeriods = sleepTodayPeriods.filter(item => typeof item.value === 'string' && item.value.toLowerCase() === 'deep');
  const sleepTodayDeepTotal = calculateTotalHours(sleepTodayDeepPeriods);

  const isHrvMissing = hrvToday.length === 0;
  const isRhrMissing = rhrRecent.length === 0;
  const isSleepMissing = sleepTodayPeriods.length === 0;

  const hrvTodayMean = isHrvMissing ? null : getMean(hrvToday);
  const rhrTodayMean = isRhrMissing ? null : getMean(rhrRecent);
  const sleepTodayTotalHours = isSleepMissing ? null : sleepTodayTotal;
  const sleepTodayDeepPercentage = (isSleepMissing || sleepTodayTotal === 0) ? null : (sleepTodayDeepTotal / sleepTodayTotal) * 100;

  // 5. 最終的な統計メトリクスの計算
  return {
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
      today_hours: sleepTodayTotalHours,
      today_deep_percentage: sleepTodayDeepPercentage
    }
  };
}

/**
 * 体調データのメトリクスを人が読めるテキストにフォーマットする
 * @param metrics 計算済みのメトリクス
 * @returns フォーマットされたテキスト
 */
export function formatConditionData(metrics: AnalysisResult['metrics']): string {
  let hrvStatus = "標準的";
  if (metrics.hrv.today !== null) {
    if (metrics.hrv.today < (metrics.hrv.baseline_median - metrics.hrv.baseline_stddev)) {
      hrvStatus = "大きく低下";
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
  
  let sleepStatus = "標準的";
  if (metrics.sleep.today_hours !== null) {
    if (metrics.sleep.today_hours < 3) {
      sleepStatus = "非常に短い（危険）";
    } else if (metrics.sleep.today_hours < metrics.sleep.baseline_mean_hours - 1) {
      sleepStatus = "短い";
    }
  }

  const formatHrv = metrics.hrv.today === null 
    ? "データ同期中" 
    : `${metrics.hrv.today.toFixed(1)} (平常時中央値${metrics.hrv.baseline_median.toFixed(1)}±${metrics.hrv.baseline_stddev.toFixed(1)}より${hrvStatus})`;

  const formatRhr = metrics.rhr.today === null
    ? "データ同期中"
    : `${metrics.rhr.today.toFixed(1)} (平常時平均${metrics.rhr.baseline_mean.toFixed(1)}より${rhrStatus})`;
    
  const formatSleep = metrics.sleep.today_hours === null
    ? "データ同期中"
    : `${metrics.sleep.today_hours.toFixed(1)}時間 (平常時${metrics.sleep.baseline_mean_hours.toFixed(1)}時間より${sleepStatus})`;

  const formatDeepSleep = metrics.sleep.today_deep_percentage === null
    ? "データ同期中"
    : `${metrics.sleep.today_deep_percentage.toFixed(1)}%`;

  return `【本日の体調データ】
・心拍変動(HRV): ${formatHrv}
・安静時心拍数(RHR): ${formatRhr}
・睡眠時間: ${formatSleep}
・深い睡眠の割合: ${formatDeepSleep}`;
}

/**
 * ヘルスケアデータの統計分析を行う
 * POST / と POST /notify の両方から共通で呼び出される
 * @param data iOSショートカットから送信されたペイロード
 * @returns 統計メトリクスとプロンプトコンテキストを含む分析結果
 */
export function analyzeHealthData(data: HealthDataPayload): AnalysisResult {
  const metrics = calculateHealthMetrics(data);
  const condition_text = formatConditionData(metrics);
  return { metrics, condition_text };
}
