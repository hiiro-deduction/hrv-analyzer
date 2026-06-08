import { ParsedHealthData } from '../types';

/**
 * 日付文字列をパースし、タイムゾーン指定がない場合は日本時間(JST, +09:00)として扱う
 * iPhoneから送信されるデータにはタイムゾーン情報が含まれないための対策
 * @param dateStr 日付文字列 (例: "2026-06-04T00:00:28")
 * @returns Dateオブジェクト
 */
export function parseDateWithJSTFallback(dateStr: string): Date {
  const cleanStr = dateStr.trim();
  if (!cleanStr) return new Date(NaN);

  const hasTimezone = cleanStr.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(cleanStr);
  return new Date(hasTimezone ? cleanStr : `${cleanStr}+09:00`);
}

/**
 * ショートカットから送られてくるカンマ区切りの文字列をパースしてオブジェクトの配列にする
 * @param dateStr 日付のカンマ区切り文字列
 * @param valueStr 値のカンマ区切り文字列
 * @param endDateStr 終了日付のカンマ区切り文字列
 * @returns パースされたヘルスデータの配列
 */
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
      // iPhoneからのデータには時差情報がないため、タイムゾーンを補完してパースする
      start: parseDateWithJSTFallback(date),
      value: parsedValue
    };
    if (endDates && endDates[index]) {
      obj.end = parseDateWithJSTFallback(endDates[index]);
    }
    return obj;
  }).filter(item => !isNaN(item.start.getTime())); // 無効な日付データ(空行など)を除外
}

/**
 * ParsedHealthDataの配列から合計期間（時間単位）を算出する。
 * 睡眠ステージなどの期間が重複している場合は結合（インターバルマージ）して重複加算を防ぐ。
 * @param periods 計算対象の期間データの配列
 * @returns 合計時間（時間）
 */
export function calculateTotalHours(periods: ParsedHealthData[]): number {
  // 終了時刻が存在し、かつ開始時刻よりも後のデータのみを有効とする
  const validPeriods = periods.filter(p => p.end && p.end.getTime() > p.start.getTime());
  if (validPeriods.length === 0) return 0;

  // 開始時刻で昇順にソートする
  const sorted = validPeriods.slice().sort((a, b) => a.start.getTime() - b.start.getTime());

  let totalMs = 0;
  let currentStart = sorted[0].start.getTime();
  let currentEnd = sorted[0].end!.getTime();

  for (let i = 1; i < sorted.length; i++) {
    const period = sorted[i];
    const pStart = period.start.getTime();
    const pEnd = period.end!.getTime();

    if (pStart <= currentEnd) {
      // 期間が重複している場合、終了時刻をより遅い方に延長する
      currentEnd = Math.max(currentEnd, pEnd);
    } else {
      // 期間が重複していない場合、これまでの期間を合計に加算し、新たな期間を開始する
      totalMs += (currentEnd - currentStart);
      currentStart = pStart;
      currentEnd = pEnd;
    }
  }
  // 最後に残った期間を加算する
  totalMs += (currentEnd - currentStart);

  return totalMs / (1000 * 60 * 60);
}
