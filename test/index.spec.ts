import { env, createExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker from "../src/index";

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
    const request = new Request("http://example.com", { method: "GET" });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(405);
    expect(await response.text()).toBe("Method Not Allowed");
  });

  it("不正なJSONフォーマットを送信した場合、400エラーを返す", async () => {
    const request = new Request("http://example.com", {
      method: "POST",
      body: "invalid-json",
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(400);
    const body = await response.json<any>();
    expect(body.error).toBe("Invalid JSON format");
  });

  it("睡眠データが存在しない場合、400エラーを返す", async () => {
    const payload = {
      hrv: { hrv_dates: "2026-06-01T00:00:00Z", hrv_value: "30" },
      rhr: { rhr_dates: "2026-06-01T00:00:00Z", rhr_value: "60" }
    };
    const request = new Request("http://example.com", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(400);
    const body = await response.json<any>();
    expect(body.error).toBe("No sleep data provided.");
  });
  
  it("正常なヘルスケアデータを送信した場合、正しい統計値とプロンプトを返す", async () => {
    const todayStart = "2026-06-04T00:00:00Z";
    const todayEnd = "2026-06-04T06:00:00Z";
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
        sleep_value: "Core,Core" 
      }
    };
    
    const request = new Request("http://example.com", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(200);
    const body = await response.json<any>();
    
    expect(body.metrics).toBeDefined();
    expect(body.metrics.hrv.baseline_median).toBe(30);
    expect(body.metrics.rhr.baseline_mean).toBe(60);
    expect(body.metrics.sleep.baseline_mean_hours).toBe(6); 

    expect(body.metrics.hrv.today).toBe(40);
    expect(body.metrics.rhr.today).toBe(65);
    expect(body.metrics.sleep.today_hours).toBe(6);
    expect(body.metrics.sleep.today_deep_percentage).toBe(0); 
    
    expect(body.prompt_context).toContain("【本日の体調データ】");
    expect(body.prompt_context).toContain("睡眠時間: 6.0時間");
    expect(body.prompt_context).toContain("深い睡眠の割合: 0.0%");
  });

  it("InBed や Awake などの睡眠ステージ以外のデータが送られた場合、実質的な睡眠時間から除外される", async () => {
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
        sleep_value: "Core,InBed,Awake"
      }
    };
    
    const request = new Request("http://example.com", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(200);
    const body = await response.json<any>();
    
    expect(body.metrics.sleep.baseline_mean_hours).toBe(2); 
  });

  it("睡眠時間の前後5分以内のHRVデータは、バッファにより睡眠中として計算される", async () => {
    const sleepStart = "2026-06-04T01:00:00Z";
    const sleepEnd = "2026-06-04T06:00:00Z";
    const hrvStart = "2026-06-04T00:56:00Z";

    const payload = {
      hrv: { hrv_dates: hrvStart, hrv_value: "50.0" },
      sleep: { sleep_start_dates: sleepStart, sleep_end_dates: sleepEnd, sleep_value: "Core" }
    };
    
    const request = new Request("http://example.com", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, env, ctx);
    const body = await response.json<any>();
    
    expect(body.metrics.hrv.today).toBe(50);
  });

  it("RHRは睡眠中かどうかにかかわらず1日1回のサマリーデータとして計算される", async () => {
    const sleepStart = "2026-06-04T01:00:00Z";
    const sleepEnd = "2026-06-04T06:00:00Z";
    const measureTime = "2026-06-04T12:00:00Z";

    const payload = {
      hrv: { hrv_dates: measureTime, hrv_value: "50.0" },
      rhr: { rhr_dates: measureTime, rhr_value: "65.0" },
      sleep: { sleep_start_dates: sleepStart, sleep_end_dates: sleepEnd, sleep_value: "Core" }
    };
    
    const request = new Request("http://example.com", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, env, ctx);
    const body = await response.json<any>();
    
    expect(body.metrics.hrv.today).toBeNull();
    expect(body.metrics.rhr.today).toBe(65);
  });

  it("今日のデータがまだ無い（同期されていない）場合、プロンプトで「データ同期中」と表示される", async () => {
    const pastStart = "2026-06-01T00:00:00Z";
    const pastEnd = "2026-06-01T06:00:00Z";

    const payload = {
      hrv: { hrv_dates: `${pastStart}`, hrv_value: "30.0" },
      rhr: { rhr_dates: `${pastStart}`, rhr_value: "60.0" },
      sleep: { sleep_start_dates: `${pastStart}`, sleep_end_dates: `${pastEnd}`, sleep_value: "Core" }
    };
    
    const request = new Request("http://example.com", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(200);
    const body = await response.json<any>();
    
    expect(body.metrics.hrv.today).toBeNull();
    expect(body.metrics.rhr.today).toBeNull();
    expect(body.metrics.sleep.today_hours).toBeNull();
    
    expect(body.prompt_context).toContain("心拍変動(HRV): データ同期中");
    expect(body.prompt_context).toContain("安静時心拍数(RHR): データ同期中");
    expect(body.prompt_context).toContain("睡眠時間: データ同期中");
    expect(body.prompt_context).toContain("深い睡眠の割合: データ同期中");
  });

  it("睡眠時間が3時間未満の場合、非常に短いと判定されシステム警告がプロンプトに追加される", async () => {
    const pastStart = "2026-06-01T00:00:00Z";
    const pastEnd = "2026-06-01T06:00:00Z"; 
    const todayStart = "2026-06-04T00:00:00Z";
    const todayEnd = "2026-06-04T02:00:00Z"; 

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

    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(200);
    const body = await response.json<any>();
    
    expect(body.metrics.sleep.today_hours).toBe(2);
    expect(body.prompt_context).toContain("非常に短い（危険）");
    expect(body.prompt_context).toContain("※【システム警告】本日の睡眠時間が3時間未満の危険域です");
    expect(body.prompt_context).toContain("深い睡眠の割合が15%を下回っています");
  });

  it("深い睡眠の割合が正しく計算される", async () => {
    const pastStart = "2026-06-01T00:00:00Z";
    const pastEnd = "2026-06-01T06:00:00Z";
    
    const todayStart1 = "2026-06-04T00:00:00Z";
    const todayEnd1 = "2026-06-04T03:00:00Z"; 
    const todayStart2 = "2026-06-04T03:00:00Z";
    const todayEnd2 = "2026-06-04T04:00:00Z"; 
    const todayStart3 = "2026-06-04T04:00:00Z";
    const todayEnd3 = "2026-06-04T05:00:00Z"; 

    const payload = {
      hrv: { hrv_dates: `${pastStart}`, hrv_value: "30.0" },
      rhr: { rhr_dates: `${pastStart}`, rhr_value: "60.0" },
      sleep: {
        sleep_start_dates: `${pastStart},${todayStart1},${todayStart2},${todayStart3}`,
        sleep_end_dates: `${pastEnd},${todayEnd1},${todayEnd2},${todayEnd3}`,
        sleep_value: "Core,Core,Deep,Rem" 
      }
    };
    
    const request = new Request("http://example.com", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(200);
    const body = await response.json<any>();
    
    expect(body.metrics.sleep.today_hours).toBe(5);
    expect(body.metrics.sleep.today_deep_percentage).toBe(20);
    expect(body.prompt_context).toContain("深い睡眠の割合: 20.0%");
    expect(body.prompt_context).not.toContain("深い睡眠の割合が15%を下回っています"); 
  });

  it("存在しないパスにPOSTした場合、404を返す", async () => {
    const request = new Request("http://example.com/unknown", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, env, ctx);

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
    const testEnv = { ...env, API_SECRET_TOKEN: "test-token", GEMINI_API_KEY: "test-key", DISCORD_WEBHOOK_URL: "https://example.com/webhook" };
    const request = new Request("http://example.com/notify", {
      method: "POST",
      body: JSON.stringify(validPayload),
      headers: { "Content-Type": "application/json" }
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, testEnv, ctx);

    expect(response.status).toBe(401);
    const body = await response.json<any>();
    expect(body.error).toBe("Unauthorized");
  });

  it("不正なトークンを送信した場合、401を返す", async () => {
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

    const response = await worker.fetch(request, testEnv, ctx);

    expect(response.status).toBe(401);
    const body = await response.json<any>();
    expect(body.error).toBe("Unauthorized");
  });

  it("正しいトークンで有効なデータを送信した場合、202 Acceptedを返す", async () => {
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

    const response = await worker.fetch(request, testEnv, ctx);

    expect(response.status).toBe(202);
    const body = await response.json<any>();
    expect(body.status).toBe("accepted");
    expect(body.message).toContain("データを受け取りました");
  });

  it("シークレットが未設定の場合、503を返す", async () => {
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

    const response = await worker.fetch(request, emptyEnv, ctx);

    expect(response.status).toBe(503);
    const body = await response.json<any>();
    expect(body.error).toBe("Service not configured");
  });

  it("GET /notify でリクエストした場合、405を返す", async () => {
    const request = new Request("http://example.com/notify", { method: "GET" });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(405);
  });

  it("正しいトークンだが不正なJSONを送信した場合、400を返す", async () => {
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

    const response = await worker.fetch(request, testEnv, ctx);

    expect(response.status).toBe(400);
    const body = await response.json<any>();
    expect(body.error).toBe("Invalid JSON format");
  });

  it("正しいトークンだが睡眠データがない場合、400を返す", async () => {
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

    const response = await worker.fetch(request, testEnv, ctx);

    expect(response.status).toBe(400);
    const body = await response.json<any>();
    expect(body.error).toBe("No sleep data provided.");
  });
});
