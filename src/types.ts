/**
 * 環境変数の型定義
 * シークレットは wrangler secret put で設定し、ローカル開発時は .dev.vars に記載する
 */
export interface Env {
  /** Gemini APIを呼び出すためのAPIキー */
  GEMINI_API_KEY?: string;
  /** Discordへ通知を送信するためのWebhook URL */
  DISCORD_WEBHOOK_URL?: string;
  /** APIエンドポイントを保護するためのシークレットトークン */
  API_SECRET_TOKEN?: string;
}

/**
 * iOSショートカットから送信されるヘルスケアデータのペイロード型定義
 */
export interface HealthDataPayload {
  /** 心拍変動(HRV)のデータ */
  hrv?: {
    /** 測定日時のカンマ区切り文字列 (例: "2026-06-01T00:00:00Z,...") */
    hrv_dates: string;
    /** 測定値のカンマ区切り文字列 */
    hrv_value: string;
  };
  /** 睡眠ステージのデータ */
  sleep?: {
    /** 睡眠開始日時のカンマ区切り文字列 */
    sleep_start_dates: string;
    /** 睡眠終了日時のカンマ区切り文字列 */
    sleep_end_dates: string;
    /** 睡眠ステージ(Core, Deep, Rem, Awake等)のカンマ区切り文字列 */
    sleep_value: string;
  };
  /** 安静時心拍数(RHR)のデータ */
  rhr?: {
    /** 測定日時のカンマ区切り文字列 */
    rhr_dates: string;
    /** 測定値のカンマ区切り文字列 */
    rhr_value: string;
  };
  /** 呼吸数(Respiratory Rate)のデータ */
  respiratory_rate?: {
    /** 測定日時のカンマ区切り文字列 */
    respiratory_rate_dates: string;
    /** 測定値のカンマ区切り文字列 (単位: 回/分) */
    respiratory_rate_value: string;
  };
}

/**
 * データ分析結果の型定義
 */
export interface AnalysisResult {
  /** 計算された各種ヘルスケアメトリクス */
  metrics: {
    /** 心拍変動(HRV)の統計情報 */
    hrv: {
      /** 過去の測定値の中央値 (ベースライン) */
      baseline_median: number;
      /** 過去の測定値の標準偏差 */
      baseline_stddev: number;
      /** 今日の測定値の平均 (未測定の場合はnull) */
      today: number | null;
    };
    /** 安静時心拍数(RHR)の統計情報 */
    rhr: {
      /** 過去の測定値の平均 (ベースライン) */
      baseline_mean: number;
      /** 今日の測定値の平均 (未測定の場合はnull) */
      today: number | null;
    };
    /** 呼吸数(Respiratory Rate)の統計情報 */
    respiratory_rate: {
      /** 過去の測定値の平均 (ベースライン) */
      baseline_mean: number;
      /** 今日の測定値の平均 (未測定の場合はnull) */
      today: number | null;
    };
    /** 睡眠時間の統計情報 */
    sleep: {
      /** 過去の平均睡眠時間（時間単位） */
      baseline_mean_hours: number;
      /** 今日の睡眠時間（時間単位、未測定の場合はnull） */
      today_hours: number | null;
      /** 今日の深い睡眠(Deep)の割合（%、未測定の場合はnull） */
      today_deep_percentage: number | null;
    };
  };
  /** 現在のコンディションをテキストにフォーマットしたもの */
  condition_text: string;
}

/**
 * パースされたヘルスデータの型定義
 */
export interface ParsedHealthData {
  /** 測定開始日時 */
  start: Date;
  /** 測定終了日時 (睡眠データなどの期間データの場合のみ存在) */
  end?: Date;
  /** 測定値 または ステージ名(文字列) */
  value: number | string;
}
