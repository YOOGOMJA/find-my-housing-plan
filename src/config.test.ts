import { loadConfig } from "./config";

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

    const config = loadConfig();
    expect(config.apiKey).toBe("test-api-key");
    expect(config.user.age).toBe(30);
    expect(config.user.regions).toEqual(["11", "41"]);
    expect(config.user.housingTypes).toEqual(["06", "13"]);
    expect(config.user.maritalStatus).toBe("single");
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
});
