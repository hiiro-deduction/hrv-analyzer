import { describe, it, expect } from "vitest";
import { parseShortcutData, calculateTotalHours } from "../../src/utils/parser";

describe("Utils: parseShortcutData", () => {
  it("空文字やundefinedが渡された場合、空配列を返す", () => {
    expect(parseShortcutData()).toEqual([]);
    expect(parseShortcutData("", "")).toEqual([]);
  });

  it("正常なカンマ区切りデータをパースしてオブジェクト配列を返す", () => {
    const dates = "2026-06-01T00:00:00Z,2026-06-01T01:00:00Z";
    const values = "10,20";
    const result = parseShortcutData(dates, values);
    expect(result).toHaveLength(2);
    expect(result[0].start.getTime()).toBe(new Date("2026-06-01T00:00:00Z").getTime());
    expect(result[0].value).toBe(10);
    expect(result[1].value).toBe(20);
  });

  it("値に欠損（空行など）が含まれる場合、0として処理される（フォールバック）", () => {
    const dates = "2026-06-01T00:00:00Z,2026-06-01T01:00:00Z";
    const values = "10,";
    const result = parseShortcutData(dates, values);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe(10);
    expect(result[1].value).toBe(0); // 未定義・空文字時は0
  });

  it("文字列（Awakeなど）が送られた場合、文字列としてパースされる", () => {
    const dates = "2026-06-01T00:00:00Z";
    const values = "Awake";
    const result = parseShortcutData(dates, values);
    expect(result[0].value).toBe("Awake");
  });

  it("日付文字列に前後の空白が含まれていても正しくタイムゾーンが判定される", () => {
    const dates = " 2026-06-01T00:00:00+09:00 , 2026-06-01T01:00:00Z ";
    const values = "10,20";
    const result = parseShortcutData(dates, values);
    expect(result).toHaveLength(2);
    expect(result[0].start.getTime()).toBe(new Date("2026-06-01T00:00:00+09:00").getTime());
    expect(result[1].start.getTime()).toBe(new Date("2026-06-01T01:00:00Z").getTime());
  });

  it("タイムゾーン情報がない場合、日本時間(JST)として補完される", () => {
    const dates = "2026-06-01T00:00:00,2026-06-01T01:00:00";
    const values = "10,20";
    const result = parseShortcutData(dates, values);
    expect(result).toHaveLength(2);
    // タイムゾーンがない場合は +09:00 として計算されるため、UTCに直すと前日の15時/16時になる
    expect(result[0].start.getTime()).toBe(new Date("2026-05-31T15:00:00Z").getTime());
    expect(result[1].start.getTime()).toBe(new Date("2026-05-31T16:00:00Z").getTime());
  });
});

describe("Utils: calculateTotalHours", () => {
  it("空の配列を渡した場合、0を返す", () => {
    expect(calculateTotalHours([])).toBe(0);
  });

  it("endが存在しない期間が含まれる場合、その期間は0時間として計算される", () => {
    const periods = [
      { start: new Date("2026-06-01T00:00:00Z"), value: "core" } // endなし
    ];
    expect(calculateTotalHours(periods)).toBe(0);
  });

  it("正常な期間の配列を渡した場合、合計時間が算出される", () => {
    const periods = [
      { start: new Date("2026-06-01T00:00:00Z"), end: new Date("2026-06-01T02:00:00Z"), value: "core" }, // 2時間
      { start: new Date("2026-06-01T03:00:00Z"), end: new Date("2026-06-01T04:30:00Z"), value: "deep" }  // 1.5時間
    ];
    expect(calculateTotalHours(periods)).toBe(3.5);
  });
});
