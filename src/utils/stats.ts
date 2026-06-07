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
