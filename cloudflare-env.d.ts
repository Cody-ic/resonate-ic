declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    REVIEW_COORDINATOR?: DurableObjectNamespace;
    REVIEW_WORKFLOW?: Workflow;
    REVIEW_DISCUSSION_CONCURRENCY?: string;
    REVIEW_PROJECT_CONCURRENCY?: string;
    ADMIN_USER_IDS?: string;
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_URL?: string;
    PLATFORM_AUTH_ENABLED?: string;
    PROJECT_REVIEW_API_KEY?: string;
    PROJECT_REVIEW_MODEL?: string;
    PROJECT_PUBLICATION_ENABLED?: string;
    DISCUSSION_REVIEW_API_KEY?: string;
    DISCUSSION_REVIEW_MODEL?: string;
    PROJECT_AI_MONTHLY_MAX_CALLS?: string;
    PROJECT_AI_MONTHLY_BUDGET_MICROS?: string;
    DISCUSSION_AI_MONTHLY_MAX_CALLS?: string;
    DISCUSSION_AI_MONTHLY_BUDGET_MICROS?: string;
    AI_TOTAL_MONTHLY_BUDGET_MICROS?: string;
    AI_INPUT_CNY_PER_MTOK?: string;
    AI_OUTPUT_CNY_PER_MTOK?: string;
    AI_CACHED_INPUT_CNY_PER_MTOK?: string;
    AI_OFFPEAK_DATES?: string;
    ADMIN_EMAILS?: string;
    MAIL_PROVIDER?: string;
    MAIL_FROM?: string;
    MAIL_GRAPH_CLIENT_ID?: string;
    MAIL_GRAPH_CLIENT_SECRET?: string;
    MAIL_GRAPH_REFRESH_TOKEN?: string;
    MAIL_DELIVERY_MODE?: string;
    MAIL_TEST_RECIPIENTS?: string;
    MAIL_REQUIRE_EMAIL_VERIFICATION?: string;
  }
}
