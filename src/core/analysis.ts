import { HealthDataPayload, AnalysisResult, ParsedHealthData } from '../types';
import { parseShortcutData, calculateTotalHours } from '../utils/parser';
import { getMean, getMedian, getStandardDeviation } from '../utils/stats';

// --- 定数 ---
export const VALID_SLEEP_STAGES = new Set(['core', 'deep', 'rem', 'asleep']);
export const SLEEP_BUFFER_MS = 5 * 60 * 1000; // 5分
export const MS_PER_HOUR = 60 * 60 * 1000;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const CRITICAL_SLEEP_HOURS = 3;
export const LOW_DEEP_SLEEP_PERCENTAGE = 15;

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
 * 睡眠期間に基づいて特定の時刻が睡眠中かどうかを判定するフィルタ関数を作成する
 * @param actualSleepPeriods 有効な睡眠ステージのデータ配列
 * @returns 睡眠中判定関数
 */
function createSleepFilter(actualSleepPeriods: ParsedHealthData[]): (date: Date) => boolean {
  return (date: Date) => {
    const time = date.getTime();
    return actualSleepPeriods.some(sleep => 
      sleep.end !== undefined &&
      (sleep.start.getTime() - SLEEP_BUFFER_MS) <= time && 
      (sleep.end.getTime() + SLEEP_BUFFER_MS) >= time
    );
  };
}

/**
 * 指定時刻を基準に、データをベースライン（過去）と直近（今日）に分割する
 * @param data パースされたヘルスデータ配列
 * @param cutoff 切断時刻
 * @returns [baseline, recent] のタプル（数値配列）
 */
function splitDataByTime(data: ParsedHealthData[], cutoff: Date): [number[], number[]] {
  const baseline = data.filter(item => item.start < cutoff).map(item => Number(item.value));
  const recent = data.filter(item => item.start >= cutoff).map(item => Number(item.value));
  return [baseline, recent];
}

/**
 * 睡眠メトリクスを計算する
 * @param sleepPeriods 睡眠データの配列
 * @param oneDayAgo 24時間前の時刻
 * @returns 睡眠メトリクスオブジェクト
 */
function calculateSleepMetrics(sleepPeriods: ParsedHealthData[], oneDayAgo: Date) {
  const baselineSleepPeriods = sleepPeriods.filter(item => 
    (item.end && item.end < oneDayAgo) || (!item.end && item.start < oneDayAgo)
  );
  const baselineSleepHoursTotal = calculateTotalHours(baselineSleepPeriods);
  
  const uniqueSleepDays = new Set(baselineSleepPeriods.map(s => {
    const logicalDate = new Date(s.start.getTime() - 12 * MS_PER_HOUR);
    return logicalDate.toISOString().split('T')[0];
  }));
  const sleepDaysCount = uniqueSleepDays.size > 0 ? uniqueSleepDays.size : 1; 
  const baselineMeanHours = baselineSleepHoursTotal / sleepDaysCount;

  const baselineDeepPeriods = baselineSleepPeriods.filter(item => typeof item.value === 'string' && item.value.toLowerCase() === 'deep');
  const baselineDeepTotal = calculateTotalHours(baselineDeepPeriods);
  const baselineDeepPercentage = baselineSleepHoursTotal > 0 ? (baselineDeepTotal / baselineSleepHoursTotal) * 100 : null;

  const sleepTodayPeriods = sleepPeriods.filter(item => 
    (item.end && item.end >= oneDayAgo) || (!item.end && item.start >= oneDayAgo)
  );
  const todayTotal = calculateTotalHours(sleepTodayPeriods);
  const sleepTodayDeepPeriods = sleepTodayPeriods.filter(item => typeof item.value === 'string' && item.value.toLowerCase() === 'deep');
  const sleepTodayDeepTotal = calculateTotalHours(sleepTodayDeepPeriods);

  const isSleepMissing = sleepTodayPeriods.length === 0;
  
  return {
    baseline_mean_hours: baselineMeanHours,
    baseline_deep_percentage: baselineDeepPercentage,
    today_hours: isSleepMissing ? null : todayTotal,
    today_deep_percentage: (isSleepMissing || todayTotal === 0) ? null : (sleepTodayDeepTotal / todayTotal) * 100
  };
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
  const rrData = parseShortcutData(data.respiratory_rate?.respiratory_rate_dates, data.respiratory_rate?.respiratory_rate_value);
  const sleepData = parseShortcutData(data.sleep?.sleep_start_dates, data.sleep?.sleep_value, data.sleep?.sleep_end_dates);

  if (sleepData.length === 0) {
    throw new AnalysisError("No sleep data provided.", 400);
  }

  // 2. 睡眠時間の特定
  const actualSleepPeriods = sleepData.filter(s => typeof s.value === 'string' && VALID_SLEEP_STAGES.has(s.value.toLowerCase()));

  // 3. 睡眠中のHRVを抽出するためのフィルタ
  const isDuringSleep = createSleepFilter(actualSleepPeriods);

  // 4. ベースライン（過去）と評価対象のデータを分割するための境界時刻を定義する
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - MS_PER_DAY);          // 今日の睡眠・HRVの境界
  const twoDaysAgo = new Date(now.getTime() - (2 * MS_PER_DAY));   // RHRの前日判定用の境界
  const sevenDaysAgo = new Date(now.getTime() - (7 * MS_PER_DAY)); // 呼吸数のベースライン(過去7日)用の境界

  // HRVの計算（睡眠中のデータのみ）
  const hrvDuringSleep = hrvData.filter(item => isDuringSleep(item.start));
  const [hrvBaseline, hrvToday] = splitDataByTime(hrvDuringSleep, oneDayAgo);
  
  // RHRの計算（前日のデータのみをtodayとして扱う）
  const rhrBaseline = rhrData.filter(item => item.start < twoDaysAgo).map(item => Number(item.value));
  const rhrRecent = rhrData.filter(item => item.start >= twoDaysAgo && item.start < oneDayAgo).map(item => Number(item.value));

  // 呼吸数の計算（睡眠中のデータのみ、過去7日間をベースライン）
  const rrDuringSleep = rrData.filter(item => isDuringSleep(item.start));
  const rrBaseline = rrDuringSleep.filter(item => item.start >= sevenDaysAgo && item.start < oneDayAgo).map(item => Number(item.value));
  const rrRecent = rrDuringSleep.filter(item => item.start >= oneDayAgo).map(item => Number(item.value));

  // Sleepの計算
  const sleepMetrics = calculateSleepMetrics(actualSleepPeriods, oneDayAgo);

  // 5. 最終的な統計メトリクスの計算
  return {
    hrv: {
      baseline_median: getMedian(hrvBaseline),
      baseline_stddev: getStandardDeviation(hrvBaseline, getMean(hrvBaseline)),
      today: hrvToday.length === 0 ? null : getMean(hrvToday)
    },
    rhr: {
      baseline_mean: getMean(rhrBaseline),
      today: rhrRecent.length === 0 ? null : getMean(rhrRecent)
    },
    respiratory_rate: {
      baseline_mean: getMean(rrBaseline),
      today: rrRecent.length === 0 ? null : getMean(rrRecent)
    },
    sleep: sleepMetrics
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
  if (metrics.sleep.today_hours !== null) {
    if (metrics.sleep.today_hours < CRITICAL_SLEEP_HOURS) {
      sleepStatus = "非常に短い（システム警告）";
    } else if (metrics.sleep.today_hours < metrics.sleep.baseline_mean_hours - 1) {
      sleepStatus = "短い";
    }
  }

  let deepSleepStatus = "標準的";
  if (metrics.sleep.today_deep_percentage !== null) {
    if (metrics.sleep.today_deep_percentage < 15) {
      deepSleepStatus = "質が低下（システム警告）";
    } else if (metrics.sleep.baseline_deep_percentage !== null && metrics.sleep.today_deep_percentage < metrics.sleep.baseline_deep_percentage - 5) {
      deepSleepStatus = "普段より質が低下";
    }
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

  return `【本日の体調データ】
・心拍変動(HRV): ${formatHrv}
・安静時心拍数(RHR): ${formatRhr}
・呼吸数: ${formatRr}
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

