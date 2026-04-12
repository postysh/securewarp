import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://050c7bc5aa26792e2b3d73cf4d7c296f@o4511205422137344.ingest.us.sentry.io/4511205432819712",

  tracesSampleRate: 0.1,

  beforeSend(event) {
    if (event.request?.data) {
      event.request.data = "[filtered]";
    }
    if (event.request?.cookies) {
      event.request.cookies = {};
    }
    if (event.request?.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
    }
    return event;
  },
});
