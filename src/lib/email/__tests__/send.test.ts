import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendEmail } from "../send";
import { welcomeTemplate } from "../templates/welcome";

describe("sendEmail — dev no-op", () => {
  const originalKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });
  afterEach(() => {
    if (originalKey !== undefined) process.env.RESEND_API_KEY = originalKey;
  });

  it("returns devNoOp without hitting the network when RESEND_API_KEY is unset", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await sendEmail({
      to: "user@example.com",
      template: "welcome",
      data: { displayName: null, driveUrl: "https://example.com/drive" },
    });
    expect(result.ok).toBe(true);
    expect(result.devNoOp).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("sendEmail — provider call", () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.EMAIL_FROM;

  beforeEach(() => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "SecureWarp <test@securewarp.example>";
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalFrom;
  });

  it("POSTs to Resend with bearer auth and returns the message id", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "msg_123" }), { status: 200 })
    );
    const result = await sendEmail({
      to: "user@example.com",
      template: "welcome",
      data: { displayName: "Alice", driveUrl: "https://example.com/drive" },
    });
    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toBe("msg_123");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      })
    );
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.from).toBe("SecureWarp <test@securewarp.example>");
    expect(body.to).toEqual(["user@example.com"]);
    expect(body.subject).toBe("Welcome to SecureWarp");
    expect(typeof body.html).toBe("string");
    expect(typeof body.text).toBe("string");
    fetchSpy.mockRestore();
  });

  it("returns ok:false on provider error without throwing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 })
    );
    const result = await sendEmail({
      to: "user@example.com",
      template: "welcome",
      data: { displayName: null, driveUrl: "https://example.com/drive" },
    });
    expect(result.ok).toBe(false);
    fetchSpy.mockRestore();
  });
});

describe("welcomeTemplate", () => {
  it("uses display name in greeting when present", () => {
    const { html, text, subject } = welcomeTemplate({
      displayName: "Alice",
      driveUrl: "https://example.com/drive",
    });
    expect(subject).toBe("Welcome to SecureWarp");
    expect(html).toContain("Welcome, Alice");
    expect(text).toContain("Welcome, Alice");
  });

  it("falls back to generic greeting when display name is null/empty", () => {
    const nullCase = welcomeTemplate({
      displayName: null,
      driveUrl: "https://example.com/drive",
    });
    expect(nullCase.html).toContain("Welcome to SecureWarp");
    expect(nullCase.html).not.toMatch(/Welcome,\s*\S/);

    const emptyCase = welcomeTemplate({
      displayName: "   ",
      driveUrl: "https://example.com/drive",
    });
    expect(emptyCase.html).toContain("Welcome to SecureWarp");
  });

  it("escapes HTML in display name to prevent injection", () => {
    const { html } = welcomeTemplate({
      displayName: "<script>alert(1)</script>",
      driveUrl: "https://example.com/drive",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
