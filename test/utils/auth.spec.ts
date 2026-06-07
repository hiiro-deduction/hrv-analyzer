import { describe, it, expect } from "vitest";
import { secureCompare } from "../../src/utils/auth";

describe("Utils: secureCompare", () => {
  it("正常に一致するトークンは true を返す", () => {
    expect(secureCompare("my-secret", "my-secret")).toBe(true);
  });

  it("不一致のトークンは false を返す", () => {
    expect(secureCompare("my-secret", "wrong-secret")).toBe(false);
  });

  it("長さが異なるトークンは false を返す", () => {
    expect(secureCompare("short", "longer-secret")).toBe(false);
  });

  it("空文字の比較", () => {
    expect(secureCompare("", "")).toBe(true);
    expect(secureCompare("a", "")).toBe(false);
    expect(secureCompare("", "a")).toBe(false);
  });
});
