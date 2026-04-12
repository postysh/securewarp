import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0.1,
  beforeSend(event) {
    // Strip any accidental sensitive data from error reports.
    // Sentry should never see keys, passwords, or encrypted content.
    if (event.request?.data) {
      event.request.data = "[filtered]";
    }
    if (event.request?.cookies) {
      event.request.cookies = {};
    }
    return event;
  },
});
