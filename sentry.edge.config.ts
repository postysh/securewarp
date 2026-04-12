import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://050c7bc5aa26792e2b3d73cf4d7c296f@o4511205422137344.ingest.us.sentry.io/4511205432819712",

  tracesSampleRate: 0.1,
});
