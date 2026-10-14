import { render } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import { KNOWN_TEMPLATE_KEYS } from "~/lib/types/app";
import {
  formatUnrecognizedKeysMessage,
  showUnrecognizedKeysToast,
} from "~/utils/zodErrors";
import {
  detectUnrecognizedKeys,
  formatUnrecognizedKeysAsText,
  resetSchema,
  totpSchema,
  type UnrecognizedKeysReport,
  urlSchema,
  zodEmail,
  zodPassword,
} from "~/utils/zodForms";
import { required } from "../mocks";

vi.mock("sonner", () => ({
  toast: { warning: vi.fn() },
}));

describe("zodPassword", () => {
  describe("valid passwords", () => {
    it("should accept passwords with all requirements", () => {
      expect(zodPassword.safeParse("Password1!").success).toBe(true);
      expect(zodPassword.safeParse("MySecure#123").success).toBe(true);
      expect(zodPassword.safeParse("Test@2024Pass").success).toBe(true);
    });

    it("should accept passwords exactly 8 characters", () => {
      expect(zodPassword.safeParse("Pass1!ab").success).toBe(true);
    });

    it("should accept long passwords", () => {
      expect(zodPassword.safeParse("ThisIsAVeryLongPassword123!@#").success).toBe(true);
    });

    it("should accept various special characters", () => {
      expect(zodPassword.safeParse("Password1!").success).toBe(true);
      expect(zodPassword.safeParse("Password1@").success).toBe(true);
      expect(zodPassword.safeParse("Password1#").success).toBe(true);
      expect(zodPassword.safeParse("Password1$").success).toBe(true);
      expect(zodPassword.safeParse("Password1%").success).toBe(true);
      expect(zodPassword.safeParse("Password1^").success).toBe(true);
      expect(zodPassword.safeParse("Password1&").success).toBe(true);
      expect(zodPassword.safeParse("Password1*").success).toBe(true);
    });
  });

  describe("invalid passwords", () => {
    it("should reject passwords shorter than 8 characters", () => {
      const result = zodPassword.safeParse("Pass1!");
      expect(result.success).toBe(false);
    });

    it("should reject passwords without uppercase", () => {
      const result = zodPassword.safeParse("password1!");
      expect(result.success).toBe(false);
    });

    it("should reject passwords without lowercase", () => {
      const result = zodPassword.safeParse("PASSWORD1!");
      expect(result.success).toBe(false);
    });

    it("should reject passwords without numbers", () => {
      const result = zodPassword.safeParse("Password!");
      expect(result.success).toBe(false);
    });

    it("should reject passwords without special characters", () => {
      const result = zodPassword.safeParse("Password1");
      expect(result.success).toBe(false);
    });

    it("should reject passwords with spaces", () => {
      const result = zodPassword.safeParse("Pass word1!");
      expect(result.success).toBe(false);
    });

    it("should reject empty strings", () => {
      const result = zodPassword.safeParse("");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("This field is required");
      }
    });
  });
});

describe("zodEmail", () => {
  describe("valid emails", () => {
    it("should accept standard email format", () => {
      expect(zodEmail.safeParse("user@example.com").success).toBe(true);
      expect(zodEmail.safeParse("test@domain.org").success).toBe(true);
    });

    it("should accept emails with subdomains", () => {
      expect(zodEmail.safeParse("user@mail.example.com").success).toBe(true);
    });

    it("should accept emails with plus tags", () => {
      expect(zodEmail.safeParse("user+tag@example.com").success).toBe(true);
    });
  });

  describe("invalid emails", () => {
    it("should reject invalid email format", () => {
      expect(zodEmail.safeParse("invalid").success).toBe(false);
      expect(zodEmail.safeParse("@example.com").success).toBe(false);
      expect(zodEmail.safeParse("user@").success).toBe(false);
    });

    it("should reject empty strings with required message", () => {
      const result = zodEmail.safeParse("");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[1].message).toBe("This field is required");
      }
    });

    it("should show invalid email message for malformed emails", () => {
      const result = zodEmail.safeParse("notanemail");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Invalid email");
      }
    });
  });
});

describe("totpSchema", () => {
  describe("valid TOTP codes", () => {
    it("should accept 6-digit numeric codes", () => {
      expect(totpSchema.safeParse({ totp: "123456" }).success).toBe(true);
      expect(totpSchema.safeParse({ totp: "000000" }).success).toBe(true);
      expect(totpSchema.safeParse({ totp: "999999" }).success).toBe(true);
    });
  });

  describe("invalid TOTP codes", () => {
    it("should reject codes with less than 6 digits", () => {
      const result = totpSchema.safeParse({ totp: "12345" });
      expect(result.success).toBe(false);
    });

    it("should reject codes with more than 6 digits", () => {
      const result = totpSchema.safeParse({ totp: "1234567" });
      expect(result.success).toBe(false);
    });

    it("should reject non-numeric codes", () => {
      const result = totpSchema.safeParse({ totp: "12345a" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Invalid code");
      }
    });

    it("should reject codes with special characters", () => {
      const result = totpSchema.safeParse({ totp: "12345!" });
      expect(result.success).toBe(false);
    });

    it("should reject empty codes", () => {
      const result = totpSchema.safeParse({ totp: "" });
      expect(result.success).toBe(false);
    });
  });
});

describe("urlSchema", () => {
  describe("valid URLs", () => {
    it("should accept HTTPS URLs", () => {
      expect(urlSchema.safeParse({ url: "https://example.com" }).success).toBe(true);
      expect(urlSchema.safeParse({ url: "https://api.example.com/v1" }).success).toBe(
        true,
      );
    });

    it("should accept localhost URLs", () => {
      expect(urlSchema.safeParse({ url: "http://localhost" }).success).toBe(true);
      expect(urlSchema.safeParse({ url: "http://localhost:3000" }).success).toBe(true);
      expect(urlSchema.safeParse({ url: "http://localhost:8080/api" }).success).toBe(
        true,
      );
      expect(
        urlSchema.safeParse({
          url: "http://127.0.0.1:7779/browse_markets",
        }).success,
      ).toBe(true);
    });

    it("should auto-prefix URLs without protocol with https://", () => {
      const result = urlSchema.safeParse({ url: "example.com" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.url).toBe("https://example.com");
      }
    });

    it("should accept URLs with paths and query params", () => {
      expect(
        urlSchema.safeParse({
          url: "https://api.example.com/v1/users?limit=10",
        }).success,
      ).toBe(true);
    });
  });

  describe("invalid URLs", () => {
    it("should reject plain HTTP URLs (non-localhost)", () => {
      const result = urlSchema.safeParse({ url: "http://example.com" });
      expect(result.success).toBe(false);
    });

    it("should reject invalid URL formats", () => {
      expect(urlSchema.safeParse({ url: "not a url" }).success).toBe(false);
      expect(urlSchema.safeParse({ url: "://missing-protocol" }).success).toBe(false);
    });
  });
});

describe("resetSchema", () => {
  describe("valid password reset", () => {
    it("should accept matching valid passwords", () => {
      const result = resetSchema.safeParse({
        password: "NewPassword1!",
        confirm: "NewPassword1!",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("invalid password reset", () => {
    it("should reject non-matching passwords", () => {
      const result = resetSchema.safeParse({
        password: "Password1!",
        confirm: "DifferentPassword1!",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const confirmError = result.error.issues.find((i) =>
          i.path.includes("confirm"),
        );
        expect(confirmError?.message).toBe("Passwords do not match");
      }
    });

    it("should reject weak passwords", () => {
      const result = resetSchema.safeParse({
        password: "weak",
        confirm: "weak",
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty passwords", () => {
      const result = resetSchema.safeParse({
        password: "",
        confirm: "",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("KNOWN_TEMPLATE_KEYS", () => {
  it("contains core template schema keys", () => {
    for (const key of [
      "name",
      "tabs",
      "groups",
      "prompts",
      "description",
      "img",
      "authentication",
      "allowCustomization",
    ]) {
      expect(KNOWN_TEMPLATE_KEYS.has(key)).toBe(true);
    }
  });
});

describe("detectUnrecognizedKeys", () => {
  const knownKeys = new Set(["name", "type", "endpoint"]);

  it("returns null when all keys are recognized", () => {
    const entries = [{ name: "Widget A", type: "table", endpoint: "/api" }];
    expect(detectUnrecognizedKeys("[test]", entries, knownKeys)).toBeNull();
  });

  it("returns null for empty entries", () => {
    expect(detectUnrecognizedKeys("[test]", [], knownKeys)).toBeNull();
  });

  it("detects unrecognized keys", () => {
    const entries = [{ name: "Widget A", type: "table", stale_time: 5000 }];
    const result = detectUnrecognizedKeys("[widgets.json]", entries, knownKeys);
    expect(result).toEqual({
      label: "[widgets.json]",
      entries: [{ name: "Widget A", keys: ["stale_time"] }],
    });
  });

  it("lists multiple unrecognized keys per entry", () => {
    const entries = [{ name: "W", foo: 1, bar: 2 }];
    const result = detectUnrecognizedKeys("[test]", entries, knownKeys);
    expect(result).toEqual({
      label: "[test]",
      entries: [{ name: "W", keys: ["foo", "bar"] }],
    });
  });

  it("handles multiple entries", () => {
    const entries = [
      { name: "A", type: "table", foo: 1 },
      { name: "B", type: "chart", bar: 2 },
    ];
    const result = detectUnrecognizedKeys("[test]", entries, knownKeys);
    expect(result).toEqual({
      label: "[test]",
      entries: [
        { name: "A", keys: ["foo"] },
        { name: "B", keys: ["bar"] },
      ],
    });
  });

  it("skips entries with only recognized keys", () => {
    const entries = [
      { name: "A", type: "table" },
      { name: "B", type: "chart", extra: true },
    ];
    const result = detectUnrecognizedKeys("[test]", entries, knownKeys);
    expect(result).toEqual({
      label: "[test]",
      entries: [{ name: "B", keys: ["extra"] }],
    });
  });

  it("uses id as fallback when name is missing", () => {
    const keysWithId = new Set(["name", "type", "endpoint", "id"]);
    const entries = [{ id: "widget_1", extra: true }];
    const result = detectUnrecognizedKeys("[test]", entries, keysWithId);
    expect(result).toEqual({
      label: "[test]",
      entries: [{ name: "widget_1", keys: ["extra"] }],
    });
  });

  it("uses 'Unknown' when neither name nor id exists", () => {
    const entries = [{ extra: true }];
    const result = detectUnrecognizedKeys("[test]", entries, knownKeys);
    expect(result).toEqual({
      label: "[test]",
      entries: [{ name: "Unknown", keys: ["extra"] }],
    });
  });

  it("skips null and non-object entries", () => {
    const entries = [null, undefined, "string", 42, { name: "Valid", bad: 1 }];
    const result = detectUnrecognizedKeys("[test]", entries, knownKeys);
    expect(result).toEqual({
      label: "[test]",
      entries: [{ name: "Valid", keys: ["bad"] }],
    });
  });
});

describe("formatUnrecognizedKeysAsText", () => {
  it("formats a single report", () => {
    const reports = [
      {
        label: "[widgets.json]",
        entries: [{ name: "W", keys: ["foo", "bar"] }],
      },
    ];
    expect(formatUnrecognizedKeysAsText(reports)).toBe("[widgets.json]\n• W: foo, bar");
  });

  it("formats multiple reports separated by blank lines", () => {
    const reports = [
      { label: "[widgets.json]", entries: [{ name: "W", keys: ["foo"] }] },
      { label: "[apps.json]", entries: [{ name: "A", keys: ["bar"] }] },
    ];
    expect(formatUnrecognizedKeysAsText(reports)).toBe(
      "[widgets.json]\n• W: foo\n\n[apps.json]\n• A: bar",
    );
  });
});

describe("formatUnrecognizedKeysMessage", () => {
  it("returns null for empty array", () => {
    expect(formatUnrecognizedKeysMessage([])).toBeNull();
  });

  // This renders inside the warning toast, which has a forced light background,
  // so the header uses a dark primitive rather than the brand/semantic colors.
  it("renders header emphasised in a colour readable on the light toast", () => {
    const reports: UnrecognizedKeysReport[] = [
      { label: "[widgets.json]", entries: [{ name: "Widget", keys: ["foo"] }] },
    ];
    const { container } = render(<div>{formatUnrecognizedKeysMessage(reports)}</div>);
    const header = container.querySelector("p");
    expect(header?.textContent).toBe("[widgets.json]");
    expect(header?.className).toContain("text-light-700");
    expect(header?.className).toContain("font-semibold");
  });

  it("renders widget name as plain text and keys as bold", () => {
    const reports: UnrecognizedKeysReport[] = [
      {
        label: "[widgets.json]",
        entries: [{ name: "My Widget", keys: ["stale_time"] }],
      },
    ];
    const { container } = render(<div>{formatUnrecognizedKeysMessage(reports)}</div>);
    const items = container.querySelectorAll("span.text-xs.pl-1");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe("• My Widget: stale_time");

    const bold = items[0].querySelector("span.font-semibold");
    expect(bold?.textContent).toBe("stale_time");
  });

  it("renders multiple items", () => {
    const reports: UnrecognizedKeysReport[] = [
      {
        label: "[widgets.json]",
        entries: [
          { name: "A", keys: ["foo"] },
          { name: "B", keys: ["bar", "baz"] },
        ],
      },
    ];
    const { container } = render(<div>{formatUnrecognizedKeysMessage(reports)}</div>);
    const items = container.querySelectorAll("span.text-xs.pl-1");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("A");
    expect(items[1].textContent).toContain("B");
  });

  it("renders multiple blocks (widgets.json + apps.json)", () => {
    const reports: UnrecognizedKeysReport[] = [
      { label: "[widgets.json]", entries: [{ name: "W", keys: ["foo"] }] },
      { label: "[apps.json]", entries: [{ name: "A", keys: ["bar"] }] },
    ];
    const { container } = render(<div>{formatUnrecognizedKeysMessage(reports)}</div>);
    const headers = container.querySelectorAll("p");
    expect(headers).toHaveLength(2);
    expect(headers[0].textContent).toBe("[widgets.json]");
    expect(headers[1].textContent).toBe("[apps.json]");
  });
});

describe("showUnrecognizedKeysToast", () => {
  const originalClipboard = navigator.clipboard;
  afterEach(() => {
    Object.assign(navigator, { clipboard: originalClipboard });
  });

  it("calls toast.warning with correct id, duration, and copy action", () => {
    const reports: UnrecognizedKeysReport[] = [
      { label: "[widgets.json]", entries: [{ name: "W", keys: ["foo"] }] },
    ];
    showUnrecognizedKeysToast({ name: "my-source", id: "my-source" }, reports);

    expect(toast.warning).toHaveBeenCalledWith(
      "Unrecognized fields: my-source",
      expect.objectContaining({
        id: "backend-unrecognized-keys-my-source",
        duration: 15000,
        action: expect.anything(),
      }),
    );
  });

  it("copy action writes plain text to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const reports: UnrecognizedKeysReport[] = [
      {
        label: "[widgets.json]",
        entries: [{ name: "W", keys: ["foo", "bar"] }],
      },
    ];
    showUnrecognizedKeysToast({ name: "src", id: "src" }, reports);

    const call = required((toast.warning as Mock).mock.calls.at(-1));
    const actionReactNode = call[1].action;
    const { container } = render(actionReactNode);
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    button?.click();

    expect(writeText).toHaveBeenCalledWith("[widgets.json]\n• W: foo, bar");
  });

  it("copy action is a no-op when clipboard API is unavailable", () => {
    Object.assign(navigator, { clipboard: undefined });
    const reports: UnrecognizedKeysReport[] = [
      { label: "[widgets.json]", entries: [{ name: "W", keys: ["foo"] }] },
    ];
    showUnrecognizedKeysToast({ name: "src", id: "src" }, reports);

    const call = required((toast.warning as Mock).mock.calls.at(-1));
    const actionReactNode = call[1].action;
    const { container } = render(actionReactNode);
    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    // Spy on console to check for no errors
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    button?.click();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
