import { env, createExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker, { getMean, getMedian, getStandardDeviation, parseShortcutData, analyzeHealthData, AnalysisError, calculateTotalHours } from "../src/index";

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
    // 分散 = ((10-20)^2 + (20-20)^2 + (30-20)^2)/3 = 200/3 = 66.666...
    // 標準偏差 = sqrt(66.666...) ≈ 8.1649658
    expect(result).toBeCloseTo(8.1649658, 5);
  });
});

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

describe("Worker API: POST /", () => {
  beforeEach(() => {
    // 時刻に依存する処理をモックし、常に同じ結果になるようにする (AAAの再現性担保)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("POST以外のメソッドでリクエストした場合、405エラーを返す", async () => {
    // Arrange
    const request = new Request("http://example.com", { method: "GET" });
    const ctx = createExecutionContext();
    
    // Act
    const response = await worker.fetch(request, env, ctx);
    
    // Assert
    expect(response.status).toBe(405);
    expect(await response.text()).toBe("Method Not Allowed");
  });

  it("不正なJSONフォーマットを送信した場合、400エラーを返す", async () => {
    // Arrange
    const request = new Request("http://example.com", {
      method: "POST",
      body: "invalid-json",
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();
    
    // Act
    const response = await worker.fetch(request, env, ctx);
    
    // Assert
    expect(response.status).toBe(400);
    const body = await response.json<any>();
    expect(body.error).toBe("Invalid JSON format");
  });

  it("睡眠データが存在しない場合、400エラーを返す", async () => {
    // Arrange
    const payload = {
      hrv: { hrv_dates: "2026-06-01T00:00:00Z", hrv_value: "30" },
      rhr: { rhr_dates: "2026-06-01T00:00:00Z", rhr_value: "60" }
      // sleepが未定義
    };
    const request = new Request("http://example.com", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, env, ctx);

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json<any>();
    expect(body.error).toBe("No sleep data provided.");
  });
  
  it("正常なヘルスケアデータを送信した場合、正しい統計値とプロンプトを返す", async () => {
    // Arrange
    // 今日のデータ (基準時刻 2026-06-04T12:00:00Z から24時間以内)
    const todayStart = "2026-06-04T00:00:00Z";
    const todayEnd = "2026-06-04T06:00:00Z";
    
    // 過去のデータ (基準時刻から24時間より前)
    const pastStart = "2026-06-01T00:00:00Z";
    const pastEnd = "2026-06-01T06:00:00Z";

    const payload = {
      hrv: {
        hrv_dates: `${pastStart},${todayStart}`,
        hrv_value: "30.0,40.0"
      },
      rhr: {
        rhr_dates: `${pastStart},${todayStart}`,
        rhr_value: "60.0,65.0"
      },
      sleep: {
        sleep_start_dates: `${pastStart},${todayStart}`,
        sleep_end_dates: `${pastEnd},${todayEnd}`,
        sleep_value: "Core,Core" // Awake以外なら睡眠としてカウントされる
      }
    };
    
    const request = new Request("http://example.com", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, env, ctx);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json<any>();
    
    expect(body.metrics).toBeDefined();
    // 過去のデータがベースラインになる
    expect(body.metrics.hrv.baseline_median).toBe(30);
    expect(body.metrics.rhr.baseline_mean).toBe(60);
    expect(body.metrics.sleep.baseline_mean_hours).toBe(6); // 1日分のデータしかないため6時間となる

    // 今日のデータが today になる
    expect(body.metrics.hrv.today).toBe(40);
    expect(body.metrics.rhr.today).toBe(65);
    expect(body.metrics.sleep.today_hours).toBe(6);
    expect(body.metrics.sleep.today_deep_percentage).toBe(0); // Coreのみなので0%
    
    expect(body.prompt_context).toContain("【本日の体調データ】");
    expect(body.prompt_context).toContain("睡眠時間: 6.0時間");
    expect(body.prompt_context).toContain("深い睡眠の割合: 0.0%");
  });

  it("InBed や Awake などの睡眠ステージ以外のデータが送られた場合、実質的な睡眠時間から除外される", async () => {
    // Arrange
    const pastStart1 = "2026-06-01T00:00:00Z";
    const pastEnd1 = "2026-06-01T02:00:00Z";
    const pastStart2 = "2026-06-01T02:00:00Z";
    const pastEnd2 = "2026-06-01T07:00:00Z";
    const pastStart3 = "2026-06-01T07:00:00Z";
    const pastEnd3 = "2026-06-01T08:00:00Z";

    const payload = {
      hrv: { hrv_dates: "2026-06-01T01:00:00Z", hrv_value: "30.0" },
      rhr: { rhr_dates: "2026-06-01T01:00:00Z", rhr_value: "60.0" },
      sleep: {
        sleep_start_dates: `${pastStart1},${pastStart2},${pastStart3}`,
        sleep_end_dates: `${pastEnd1},${pastEnd2},${pastEnd3}`,
        sleep_value: "Core,InBed,Awake" // InBed (5時間) と Awake (1時間) は除外され、Core (2時間) だけが実質的な睡眠として計算されるはず
      }
    };
    
    const request = new Request("http://example.com", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, env, ctx);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json<any>();
    
    expect(body.metrics.sleep.baseline_mean_hours).toBe(2); // 2 + 5 ではなく 2 になる
  });

  it("睡眠時間の前後5分以内のHRVデータは、バッファにより睡眠中として計算される", async () => {
    // Arrange
    // 睡眠は 01:00:00 ~ 06:00:00
    const sleepStart = "2026-06-04T01:00:00Z";
    const sleepEnd = "2026-06-04T06:00:00Z";
    
    // HRVは睡眠開始の「4分前」に計測されている（本来なら範囲外だが、5分バッファにより含まれるはず）
    const hrvStart = "2026-06-04T00:56:00Z";

    const payload = {
      hrv: {
        hrv_dates: hrvStart,
        hrv_value: "50.0"
      },
      sleep: {
        sleep_start_dates: sleepStart,
        sleep_end_dates: sleepEnd,
        sleep_value: "Core"
      }
    };
    
    const request = new Request("http://example.com", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, env, ctx);
    const body = await response.json<any>();
    
    // Assert
    // HRVが正しく抽出され、todayの平均値として50が算出されているはず
    expect(body.metrics.hrv.today).toBe(50);
  });

  it("RHRは睡眠中かどうかにかかわらず1日1回のサマリーデータとして計算される", async () => {
    // Arrange
    // 睡眠は 01:00:00 ~ 06:00:00
    const sleepStart = "2026-06-04T01:00:00Z";
    const sleepEnd = "2026-06-04T06:00:00Z";
    
    // HRVとRHRは睡眠時間外の 12:00:00 に計測されている
    const measureTime = "2026-06-04T12:00:00Z";

    const payload = {
      hrv: {
        hrv_dates: measureTime,
        hrv_value: "50.0"
      },
      rhr: {
        rhr_dates: measureTime,
        rhr_value: "65.0"
      },
      sleep: {
        sleep_start_dates: sleepStart,
        sleep_end_dates: sleepEnd,
        sleep_value: "Core"
      }
    };
    
    const request = new Request("http://example.com", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, env, ctx);
    const body = await response.json<any>();
    
    // Assert
    // 睡眠時間外のため、HRVは含まれない（todayはnullになる）
    expect(body.metrics.hrv.today).toBeNull();
    // RHRは睡眠時間外でも含まれる
    expect(body.metrics.rhr.today).toBe(65);
  });

  it("今日のデータがまだ無い（同期されていない）場合、プロンプトで「データ同期中」と表示される", async () => {
    // Arrange
    // 過去のデータのみ存在し、今日のデータは無い状態
    const pastStart = "2026-06-01T00:00:00Z";
    const pastEnd = "2026-06-01T06:00:00Z";

    const payload = {
      hrv: {
        hrv_dates: `${pastStart}`,
        hrv_value: "30.0"
      },
      rhr: {
        rhr_dates: `${pastStart}`,
        rhr_value: "60.0"
      },
      sleep: {
        sleep_start_dates: `${pastStart}`,
        sleep_end_dates: `${pastEnd}`,
        sleep_value: "Core"
      }
    };
    
    const request = new Request("http://example.com", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, env, ctx);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json<any>();
    
    // データ未同期時は数値の0ではなく、APIとしてより適切な null を返すことを検証
    expect(body.metrics.hrv.today).toBeNull();
    expect(body.metrics.rhr.today).toBeNull();
    expect(body.metrics.sleep.today_hours).toBeNull();
    
    expect(body.prompt_context).toContain("心拍変動(HRV): データ同期中");
    expect(body.prompt_context).toContain("安静時心拍数(RHR): データ同期中");
    expect(body.prompt_context).toContain("睡眠時間: データ同期中");
    expect(body.prompt_context).toContain("深い睡眠の割合: データ同期中");
  });

  it("睡眠時間が3時間未満の場合、非常に短いと判定されシステム警告がプロンプトに追加される", async () => {
    // Arrange
    const pastStart = "2026-06-01T00:00:00Z";
    const pastEnd = "2026-06-01T06:00:00Z"; // 過去は6時間睡眠
    
    const todayStart = "2026-06-04T00:00:00Z";
    const todayEnd = "2026-06-04T02:00:00Z"; // 今日は2時間睡眠 (3時間未満)

    const payload = {
      hrv: { hrv_dates: `${pastStart},${todayStart}`, hrv_value: "30.0,40.0" },
      rhr: { rhr_dates: `${pastStart},${todayStart}`, rhr_value: "60.0,65.0" },
      sleep: {
        sleep_start_dates: `${pastStart},${todayStart}`,
        sleep_end_dates: `${pastEnd},${todayEnd}`,
        sleep_value: "Core,Core"
      }
    };
    
    const request = new Request("http://example.com", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, env, ctx);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json<any>();
    
    expect(body.metrics.sleep.today_hours).toBe(2);
    // 睡眠時間に関する記述を検証
    expect(body.prompt_context).toContain("非常に短い（危険）");
    expect(body.prompt_context).toContain("※【システム警告】本日の睡眠時間が3時間未満の危険域です");
    // Deep sleep is 0%, so deep sleep warning should also appear.
    expect(body.prompt_context).toContain("深い睡眠の割合が15%を下回っています");
  });

  it("深い睡眠の割合が正しく計算される", async () => {
    // Arrange
    const pastStart = "2026-06-01T00:00:00Z";
    const pastEnd = "2026-06-01T06:00:00Z";
    
    const todayStart1 = "2026-06-04T00:00:00Z";
    const todayEnd1 = "2026-06-04T03:00:00Z"; // Core 3時間
    const todayStart2 = "2026-06-04T03:00:00Z";
    const todayEnd2 = "2026-06-04T04:00:00Z"; // Deep 1時間
    const todayStart3 = "2026-06-04T04:00:00Z";
    const todayEnd3 = "2026-06-04T05:00:00Z"; // Rem 1時間

    const payload = {
      hrv: { hrv_dates: `${pastStart}`, hrv_value: "30.0" },
      rhr: { rhr_dates: `${pastStart}`, rhr_value: "60.0" },
      sleep: {
        sleep_start_dates: `${pastStart},${todayStart1},${todayStart2},${todayStart3}`,
        sleep_end_dates: `${pastEnd},${todayEnd1},${todayEnd2},${todayEnd3}`,
        sleep_value: "Core,Core,Deep,Rem" // Deepは1時間、全体で5時間なので20%
      }
    };
    
    const request = new Request("http://example.com", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, env, ctx);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json<any>();
    
    expect(body.metrics.sleep.today_hours).toBe(5);
    expect(body.metrics.sleep.today_deep_percentage).toBe(20);
    expect(body.prompt_context).toContain("深い睡眠の割合: 20.0%");
    expect(body.prompt_context).not.toContain("深い睡眠の割合が15%を下回っています"); // 15%以上なので警告なし
  });

  it("存在しないパスにPOSTした場合、404を返す", async () => {
    // Arrange
    const request = new Request("http://example.com/unknown", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, env, ctx);

    // Assert
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });
});

describe("Worker API: POST /notify", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // テスト用の正常なペイロード
  const validPayload = {
    hrv: { hrv_dates: "2026-06-01T00:00:00Z,2026-06-04T00:00:00Z", hrv_value: "30.0,40.0" },
    rhr: { rhr_dates: "2026-06-01T00:00:00Z,2026-06-04T00:00:00Z", rhr_value: "60.0,65.0" },
    sleep: {
      sleep_start_dates: "2026-06-01T00:00:00Z,2026-06-04T00:00:00Z",
      sleep_end_dates: "2026-06-01T06:00:00Z,2026-06-04T06:00:00Z",
      sleep_value: "Core,Core"
    }
  };

  it("Authorizationヘッダーがない場合、401を返す", async () => {
    // Arrange
    const testEnv = { ...env, API_SECRET_TOKEN: "test-token", GEMINI_API_KEY: "test-key", DISCORD_WEBHOOK_URL: "https://example.com/webhook" };
    const request = new Request("http://example.com/notify", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, testEnv, ctx);

    // Assert
    expect(response.status).toBe(401);
    const body = await response.json<any>();
    expect(body.error).toBe("Unauthorized");
  });

  it("不正なトークンを送信した場合、401を返す", async () => {
    // Arrange
    const testEnv = { ...env, API_SECRET_TOKEN: "correct-token", GEMINI_API_KEY: "test-key", DISCORD_WEBHOOK_URL: "https://example.com/webhook" };
    const request = new Request("http://example.com/notify", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer wrong-token"
      }
    });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, testEnv, ctx);

    // Assert
    expect(response.status).toBe(401);
    const body = await response.json<any>();
    expect(body.error).toBe("Unauthorized");
  });

  it("正しいトークンで有効なデータを送信した場合、202 Acceptedを返す", async () => {
    // Arrange
    const testEnv = { ...env, API_SECRET_TOKEN: "test-token", GEMINI_API_KEY: "test-key", DISCORD_WEBHOOK_URL: "https://example.com/webhook" };
    const request = new Request("http://example.com/notify", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-token"
      }
    });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, testEnv, ctx);

    // Assert
    expect(response.status).toBe(202);
    const body = await response.json<any>();
    expect(body.status).toBe("accepted");
    expect(body.message).toContain("データを受け取りました");
  });

  it("シークレットが未設定の場合、503を返す", async () => {
    // Arrange
    // env にシークレットが含まれていない状態を再現（.dev.varsから読み込まれる値を明示的に除去）
    const emptyEnv = { ...env, API_SECRET_TOKEN: undefined, GEMINI_API_KEY: undefined, DISCORD_WEBHOOK_URL: undefined };
    const request = new Request("http://example.com/notify", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer some-token"
      }
    });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, emptyEnv, ctx);

    // Assert
    expect(response.status).toBe(503);
    const body = await response.json<any>();
    expect(body.error).toBe("Service not configured");
  });

  it("GET /notify でリクエストした場合、405を返す", async () => {
    // Arrange
    const request = new Request("http://example.com/notify", { method: "GET" });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, env, ctx);

    // Assert
    expect(response.status).toBe(405);
  });

  it("正しいトークンだが不正なJSONを送信した場合、400を返す", async () => {
    // Arrange
    const testEnv = { ...env, API_SECRET_TOKEN: "test-token", GEMINI_API_KEY: "test-key", DISCORD_WEBHOOK_URL: "https://example.com/webhook" };
    const request = new Request("http://example.com/notify", {
      method: "POST",
      body: "not-json",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-token"
      }
    });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, testEnv, ctx);

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json<any>();
    expect(body.error).toBe("Invalid JSON format");
  });

  it("正しいトークンだが睡眠データがない場合、400を返す", async () => {
    // Arrange
    const testEnv = { ...env, API_SECRET_TOKEN: "test-token", GEMINI_API_KEY: "test-key", DISCORD_WEBHOOK_URL: "https://example.com/webhook" };
    const payload = {
      hrv: { hrv_dates: "2026-06-01T00:00:00Z", hrv_value: "30" },
      rhr: { rhr_dates: "2026-06-01T00:00:00Z", rhr_value: "60" }
    };
    const request = new Request("http://example.com/notify", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-token"
      }
    });
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, testEnv, ctx);

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json<any>();
    expect(body.error).toBe("No sleep data provided.");
  });
});

describe("analyzeHealthData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("睡眠データが空の場合、AnalysisErrorをスローする", () => {
    // Arrange
    const data = {
      hrv: { hrv_dates: "2026-06-01T00:00:00Z", hrv_value: "30" }
    };

    // Act & Assert
    expect(() => analyzeHealthData(data)).toThrow(AnalysisError);
    expect(() => analyzeHealthData(data)).toThrow("No sleep data provided.");
  });

  it("正常なデータで分析結果が正しい構造を持つ", () => {
    // Arrange
    const data = {
      hrv: { hrv_dates: "2026-06-01T00:00:00Z,2026-06-04T00:00:00Z", hrv_value: "30.0,40.0" },
      rhr: { rhr_dates: "2026-06-01T00:00:00Z,2026-06-04T00:00:00Z", rhr_value: "60.0,65.0" },
      sleep: {
        sleep_start_dates: "2026-06-01T00:00:00Z,2026-06-04T00:00:00Z",
        sleep_end_dates: "2026-06-01T06:00:00Z,2026-06-04T06:00:00Z",
        sleep_value: "Core,Core"
      }
    };

    // Act
    const result = analyzeHealthData(data);

    // Assert
    expect(result).toHaveProperty('metrics');
    expect(result).toHaveProperty('prompt_context');
    expect(result.metrics.hrv).toHaveProperty('baseline_median');
    expect(result.metrics.hrv).toHaveProperty('baseline_stddev');
    expect(result.metrics.hrv).toHaveProperty('today');
    expect(result.prompt_context).toContain("【本日の体調データ】");
  });
});
