import { describe, it, expect } from "vitest";
import { getMean, getMedian, getStandardDeviation } from "../../src/utils/stats";

describe("Utils: getMean", () => {
  it("空の配列を渡した場合、0を返す", () => {
    // Arrange
    const values: number[] = [];
    // Act
    const result = getMean(values);
    // Assert
    expect(result).toBe(0);
  });

  it("正常な数値配列を渡した場合、正しい平均値を返す", () => {
    // Arrange
    const values = [10, 20, 30];
    // Act
    const result = getMean(values);
    // Assert
    expect(result).toBe(20);
  });
});

describe("Utils: getMedian", () => {
  it("空の配列を渡した場合、0を返す", () => {
    // Arrange
    const values: number[] = [];
    // Act
    const result = getMedian(values);
    // Assert
    expect(result).toBe(0);
  });

  it("要素数が奇数の場合、中央の値を返す", () => {
    // Arrange
    const values = [10, 30, 20];
    // Act
    const result = getMedian(values);
    // Assert
    expect(result).toBe(20); // sortされるので10,20,30の中央
  });

  it("要素数が偶数の場合、中央2つの値の平均を返す", () => {
    // Arrange
    const values = [10, 40, 30, 20];
    // Act
    const result = getMedian(values);
    // Assert
    expect(result).toBe(25); // sortされるので10,20,30,40の中央
  });
});

describe("Utils: getStandardDeviation", () => {
  it("空の配列を渡した場合、0を返す", () => {
    // Arrange
    const values: number[] = [];
    const mean = 0;
    // Act
    const result = getStandardDeviation(values, mean);
    // Assert
    expect(result).toBe(0);
  });

  it("正常な数値配列を渡した場合、正しい標準偏差を返す", () => {
    // Arrange
    const values = [10, 20, 30];
    const mean = 20;
    // Act
    const result = getStandardDeviation(values, mean);
    // Assert
    expect(result).toBeCloseTo(8.1649658, 5);
  });
});
