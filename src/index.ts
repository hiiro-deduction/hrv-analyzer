export interface Env {}

// iOSショートカットから送信されるヘルスケアデータの型定義
export interface HealthDataPayload {
  hrv?: {
    hrv_dates: string;
    hrv_value: string;
  };
  sleep?: {
    sleep_start_dates: string;
    sleep_end_dates: string;
    sleep_value: string;
  };
  rhr?: {
    rhr_dates: string;
    rhr_value: string;
  };
}

// --- ユーティリティ関数 ---

/**
 * 平均値を計算する関数
 * @param values 計算対象の数値配列
 * @returns 平均値
 */
export function getMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * 中央値を計算する関数
 * @param values 計算対象の数値配列
 * @returns 中央値
 */
export function getMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  
  if (sorted.length % 2 === 0) {
    return (sorted[half - 1] + sorted[half]) / 2.0;
  }
  return sorted[half];
}

/**
 * 標準偏差を計算する関数
 * @param values 計算対象の数値配列
 * @param mean 平均値
 * @returns 標準偏差
 */
export function getStandardDeviation(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const squareDiffs = values.map((value) => {
    const diff = value - mean;
    return diff * diff;
  });
  const avgSquareDiff = getMean(squareDiffs);
  return Math.sqrt(avgSquareDiff);
}

export interface ParsedHealthData {
  start: Date;
  end?: Date;
  value: number | string;
}

// ショートカットから送られてくる改行区切りの文字列をパースしてオブジェクトの配列にする関数
export function parseShortcutData(dateStr?: string, valueStr?: string, endDateStr?: string): ParsedHealthData[] {
  if (!dateStr || !valueStr) return [];
  const dates = dateStr.trim().split(',');
  const values = valueStr.trim().split(',');
  const endDates = endDateStr ? endDateStr.trim().split(',') : null;

  return dates.map((date, index) => {
    let parsedValue: number | string = 0; // デフォルト値（欠損対策）
    if (values[index] !== undefined && values[index].trim() !== "") {
      const num = parseFloat(values[index]);
      parsedValue = !isNaN(num) ? num : values[index]; // 数値に変換できれば数値、できなければ文字列（Awake等）
    }

    const obj: ParsedHealthData = {
      start: new Date(date),
      value: parsedValue
    };
    if (endDates && endDates[index]) {
      obj.end = new Date(endDates[index]);
    }
    return obj;
  }).filter(item => !isNaN(item.start.getTime())); // 無効な日付データ(空行など)を除外
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let data: HealthDataPayload;
    try {
      data = await request.json<HealthDataPayload>();
    } catch (error) {
      return Response.json({ error: "Invalid JSON format" }, { status: 400 });
    }

    try {
      // 1. データのパース（文字列から配列へ復元）
      const hrvData = parseShortcutData(data.hrv?.hrv_dates, data.hrv?.hrv_value);
      const rhrData = parseShortcutData(data.rhr?.rhr_dates, data.rhr?.rhr_value);
      const sleepData = parseShortcutData(data.sleep?.sleep_start_dates, data.sleep?.sleep_value, data.sleep?.sleep_end_dates);

      if (sleepData.length === 0) {
        return Response.json({ error: "No sleep data provided." }, { status: 400 });
      }

      // 2. 睡眠時間の特定と「Awake(覚醒)」の除外
      // Apple Healthの睡眠ステージのうち、「Awake」以外を実質的な睡眠とみなす
      const actualSleepPeriods = sleepData.filter(s => typeof s.value === 'string' && s.value.toLowerCase() !== 'awake');

      // 3. 睡眠中のHRVとRHRのみを抽出する関数（計測タイミングのズレを考慮して前後5分のバッファを持たせる）
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

      // HRVの分割と抽出（睡眠中のみ）
      const hrvBaseline = hrvData
        .filter(item => item.start < oneDayAgo && isDuringSleep(item.start))
        .map(item => Number(item.value));
      const hrvToday = hrvData
        .filter(item => item.start >= oneDayAgo && isDuringSleep(item.start))
        .map(item => Number(item.value));
      
      // RHRの分割と抽出（睡眠中のみ）
      const rhrBaseline = rhrData
        .filter(item => item.start < oneDayAgo && isDuringSleep(item.start))
        .map(item => Number(item.value));
      const rhrToday = rhrData
        .filter(item => item.start >= oneDayAgo && isDuringSleep(item.start))
        .map(item => Number(item.value));

      // 睡眠時間の計算（1日あたりの平均時間と、今日の合計時間）
      const baselineSleepPeriods = actualSleepPeriods.filter(item => item.start < oneDayAgo);
      const baselineSleepHoursTotal = baselineSleepPeriods.reduce((acc, s) => acc + (s.end ? (s.end.getTime() - s.start.getTime()) / (1000 * 60 * 60) : 0), 0);
      
      // 睡眠記録が存在する実日数を計算（夜をまたぐ睡眠を同一日として扱うため、12時間シフトして日付を判定）
      const uniqueSleepDays = new Set(baselineSleepPeriods.map(s => {
        const logicalDate = new Date(s.start.getTime() - 12 * 60 * 60 * 1000);
        return logicalDate.toISOString().split('T')[0];
      }));
      const sleepDaysCount = uniqueSleepDays.size > 0 ? uniqueSleepDays.size : 1; // 0除算防止
      const sleepBaselineMean = baselineSleepHoursTotal / sleepDaysCount;

      const sleepTodayPeriods = actualSleepPeriods.filter(item => item.start >= oneDayAgo);
      const sleepTodayTotal = sleepTodayPeriods.reduce((acc, s) => acc + (s.end ? (s.end.getTime() - s.start.getTime()) / (1000 * 60 * 60) : 0), 0);


      const isHrvMissing = hrvToday.length === 0;
      const isRhrMissing = rhrToday.length === 0;
      const isSleepMissing = sleepTodayPeriods.length === 0;

      // 今日のデータが存在しない場合はnullを返すようにし、AIやクライアントが誤って0として扱わないようにする
      const hrvTodayMean = isHrvMissing ? null : getMean(hrvToday);
      const rhrTodayMean = isRhrMissing ? null : getMean(rhrToday);
      const sleepTodayTotalHours = isSleepMissing ? null : sleepTodayTotal;

      // 5. 最終的な統計メトリクスの計算
      const metrics = {
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
          today_hours: sleepTodayTotalHours
        }
      };

      // 6. 状態判定ロジックとプロンプト用コンテキストの生成
      // データが存在する場合のみ判定ロジックを実行する（意味のない比較を防ぐ）
      
      let hrvStatus = "良好";
      if (hrvTodayMean !== null) {
        if (hrvTodayMean < (metrics.hrv.baseline_median - metrics.hrv.baseline_stddev)) {
          hrvStatus = "大きく低下（疲労あり）";
        } else if (hrvTodayMean < metrics.hrv.baseline_median) {
          hrvStatus = "やや低め";
        }
      }

      let rhrStatus = "標準的";
      if (rhrTodayMean !== null) {
        if (rhrTodayMean > metrics.rhr.baseline_mean + 3) {
          rhrStatus = "高め（負荷あり）";
        }
      }
      
      let sleepStatus = "標準的";
      if (sleepTodayTotalHours !== null) {
        if (sleepTodayTotalHours < metrics.sleep.baseline_mean_hours - 1) {
          sleepStatus = "短い";
        }
      }

      // 小数点第1位で丸めて出力します
      const formatHrv = hrvTodayMean === null 
        ? "データ同期中" 
        : `${hrvTodayMean.toFixed(1)} (平常時中央値${metrics.hrv.baseline_median.toFixed(1)}±${metrics.hrv.baseline_stddev.toFixed(1)}より${hrvStatus})`;

      const formatRhr = rhrTodayMean === null
        ? "データ同期中"
        : `${rhrTodayMean.toFixed(1)} (平常時平均${metrics.rhr.baseline_mean.toFixed(1)}より${rhrStatus})`;
        
      const formatSleep = sleepTodayTotalHours === null
        ? "データ同期中"
        : `${sleepTodayTotalHours.toFixed(1)}時間 (平常時${metrics.sleep.baseline_mean_hours.toFixed(1)}時間より${sleepStatus})`;

      // プロンプト用のフォーマットで文字列を組み立てる
      const promptContext = `【本日の体調データ】
・心拍変動(HRV): ${formatHrv}
・安静時心拍数(RHR): ${formatRhr}
・睡眠時間: ${formatSleep}

上記は私の今日のコンディションデータです。`;

      // 7. 計算結果とテキストの両方をJSONで返す
      return Response.json({ 
        metrics: metrics,
        prompt_context: promptContext
      });

    } catch (error) {
      console.error("Internal Server Error:", error);
      return Response.json({ error: "Internal Server Error" }, { status: 500 });
    }
  },
};