import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://050c7bc5aa26792e2b3d73cf4d7c296f@o4511205422137344.ingest.us.sentry.io/4511205432819712",

  // Don't send PII — zero-knowledge app
  sendDefaultPii: false,

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
  ],

  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  beforeSend(event) {
    // Strip request bodies, cookies, auth headers — Sentry must
    // never see keys, passwords, or encrypted content.
    if (event.request?.data) {
      event.request.data = "[filtered]";
    }
    if (event.request?.cookies) {
      event.request.cookies = {};
    }
    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
