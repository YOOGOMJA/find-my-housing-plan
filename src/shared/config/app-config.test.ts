import { loadConfig } from ".";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("필수 환경변수가 모두 있으면 설정 객체를 반환한다", () => {
    process.env.PUBLIC_DATA_API_KEY = "test-api-key";
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    process.env.USER_AGE = "30";
    process.env.USER_MARITAL_STATUS = "single";
    process.env.USER_HOUSEHOLD_SIZE = "1";
    process.env.USER_CURRENT_REGION = "11";
    process.env.USER_NO_HOME_YEARS = "5";
    process.env.USER_INCOME = "300";
    process.env.USER_ASSET = "30000";
    process.env.USER_CAR_ASSET = "0";
    process.env.USER_SUBSCRIPTION_DATE = "2020-01-01";
    process.env.USER_SUBSCRIPTION_COUNT = "24";
    process.env.USER_SUBSCRIPTION_AMOUNT = "480";
    process.env.USER_REGIONS = "11,41";
    process.env.USER_MIN_AREA = "20";
    process.env.USER_MAX_AREA = "60";
    process.env.USER_MIN_BUILD_YEAR = "2010";
    process.env.USER_HOUSING_TYPES = "06,13";
    process.env.USER_DISTRICTS = "송파구,관악구";
    process.env.USER_MAX_DEPOSIT = "15000";
    process.env.USER_MAX_RENT = "50";
    process.env.USER_APPLICANT_GROUP = "youth";

    const config = loadConfig();
    expect(config.apiKey).toBe("test-api-key");
    expect(config.user.age).toBe(30);
    expect(config.user.regions).toEqual(["11", "41"]);
    expect(config.user.housingTypes).toEqual(["06", "13"]);
    expect(config.user.maritalStatus).toBe("single");
    expect(config.user.districts).toEqual(["송파구", "관악구"]);
    expect(config.user.maxDeposit).toBe(15000);
    expect(config.user.maxRent).toBe(50);
    expect(config.user.applicantGroup).toBe("youth");
    expect(config.performance.collectConcurrency).toBe(4);
    expect(config.performance.classifyConcurrency).toBe(2);
    expect(config.performance.parseConcurrency).toBe(2);
    expect(config.performance.httpKeepAlive).toBe(true);
    expect(config.performance.timingSummary).toBe(true);
    expect(config.reprocess.enabled).toBe(false);
    expect(config.reprocess.dryRun).toBe(false);
    expect(config.reprocess.lookbackMonths).toBe(6);
    expect(config.reprocess.maxNotifications).toBe(50);
    expect(config.incomeStandard.path).toBe("data/income-standards/latest.json");
    expect(config.incomeStandard.year).toBeNull();
  });

  it("필수 환경변수 누락 시 오류를 던진다", () => {
    process.env.PUBLIC_DATA_API_KEY = "";
    expect(() => loadConfig()).toThrow("PUBLIC_DATA_API_KEY");
  });

  it("숫자 환경변수가 숫자가 아니면 오류를 던진다", () => {
    process.env.PUBLIC_DATA_API_KEY = "test-api-key";
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    process.env.USER_AGE = "abc";

    expect(() => loadConfig()).toThrow("USER_AGE");
  });

  describe("신규 사용자 env 필드", () => {
    beforeEach(() => {
      process.env.PUBLIC_DATA_API_KEY = "test-key";
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
      process.env.USER_AGE = "30";
      process.env.USER_MARITAL_STATUS = "single";
    });

    it("USER_DISTRICTS 미설정 시 빈 배열", () => {
      delete process.env.USER_DISTRICTS;
      const config = loadConfig();
      expect(config.user.districts).toEqual([]);
    });

    it("USER_MAX_DEPOSIT 미설정 시 0", () => {
      delete process.env.USER_MAX_DEPOSIT;
      const config = loadConfig();
      expect(config.user.maxDeposit).toBe(0);
    });

    it("USER_MAX_RENT 미설정 시 0", () => {
      delete process.env.USER_MAX_RENT;
      const config = loadConfig();
      expect(config.user.maxRent).toBe(0);
    });

    it("USER_APPLICANT_GROUP 유효하지 않은 값은 null 반환", () => {
      process.env.USER_APPLICANT_GROUP = "invalid-group";
      const config = loadConfig();
      expect(config.user.applicantGroup).toBeNull();
    });

    it("USER_APPLICANT_GROUP 미설정 시 general 기본값", () => {
      delete process.env.USER_APPLICANT_GROUP;
      const config = loadConfig();
      // "general"은 유효한 값이므로 그대로 반환
      expect(config.user.applicantGroup).toBe("general");
    });

    it("성능 관련 env 미설정 시 기본값을 사용한다", () => {
      delete process.env.COLLECT_CONCURRENCY;
      delete process.env.CLASSIFY_CONCURRENCY;
      delete process.env.PARSE_CONCURRENCY;
      delete process.env.HTTP_KEEP_ALIVE;
      delete process.env.PERF_TIMING_SUMMARY;

      const config = loadConfig();
      expect(config.performance.collectConcurrency).toBe(4);
      expect(config.performance.classifyConcurrency).toBe(2);
      expect(config.performance.parseConcurrency).toBe(2);
      expect(config.performance.httpKeepAlive).toBe(true);
      expect(config.performance.timingSummary).toBe(true);
      expect(config.reprocess.enabled).toBe(false);
      expect(config.reprocess.dryRun).toBe(false);
      expect(config.reprocess.lookbackMonths).toBe(6);
      expect(config.reprocess.maxNotifications).toBe(50);
      expect(config.incomeStandard.path).toBe("data/income-standards/latest.json");
      expect(config.incomeStandard.year).toBeNull();
    });

    it("COLLECT_CONCURRENCY가 0 이하이면 오류를 던진다", () => {
      process.env.COLLECT_CONCURRENCY = "0";
      expect(() => loadConfig()).toThrow("COLLECT_CONCURRENCY");
    });

    it("재처리 관련 env를 읽는다", () => {
      process.env.REPROCESS_ENABLED = "true";
      process.env.REPROCESS_DRY_RUN = "true";
      process.env.REPROCESS_LOOKBACK_MONTHS = "3";
      process.env.REPROCESS_MAX_NOTIFICATIONS = "20";

      const config = loadConfig();
      expect(config.reprocess.enabled).toBe(true);
      expect(config.reprocess.dryRun).toBe(true);
      expect(config.reprocess.lookbackMonths).toBe(3);
      expect(config.reprocess.maxNotifications).toBe(20);
    });

    it("소득 기준표 관련 env를 읽는다", () => {
      process.env.INCOME_STANDARD_PATH = "/tmp/standards/latest.json";
      process.env.INCOME_STANDARD_YEAR = "2025";

      const config = loadConfig();
      expect(config.incomeStandard.path).toBe("/tmp/standards/latest.json");
      expect(config.incomeStandard.year).toBe(2025);
    });
  });
});
