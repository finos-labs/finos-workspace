import { describe, expect, it } from "vitest";
import { validateEmail, validateFolderName } from "~/utils/validators";
import { malformed } from "../mocks";

describe("validateEmail", () => {
  describe("valid emails", () => {
    it("should accept standard email format", () => {
      expect(validateEmail("user@example.com")).toBe(true);
      expect(validateEmail("test@domain.org")).toBe(true);
      expect(validateEmail("admin@company.net")).toBe(true);
    });

    it("should accept emails with subdomains", () => {
      expect(validateEmail("user@mail.example.com")).toBe(true);
      expect(validateEmail("test@sub.domain.co.uk")).toBe(true);
    });

    it("should accept emails with plus tags", () => {
      expect(validateEmail("user+tag@example.com")).toBe(true);
      expect(validateEmail("test+newsletter@gmail.com")).toBe(true);
    });

    it("should accept emails with dots in local part", () => {
      expect(validateEmail("first.last@example.com")).toBe(true);
      expect(validateEmail("john.doe.smith@domain.org")).toBe(true);
    });

    it("should accept emails with numbers", () => {
      expect(validateEmail("user123@example.com")).toBe(true);
      expect(validateEmail("test99@domain123.com")).toBe(true);
    });

    it("should accept emails with hyphens in domain", () => {
      expect(validateEmail("user@my-domain.com")).toBe(true);
      expect(validateEmail("test@sub-domain.example.org")).toBe(true);
    });

    it("should accept IP address domains in brackets", () => {
      expect(validateEmail("user@[192.168.1.1]")).toBe(true);
      expect(validateEmail("admin@[127.0.0.1]")).toBe(true);
    });

    it("should accept quoted local parts", () => {
      expect(validateEmail('"quoted"@example.com')).toBe(true);
      expect(validateEmail('"john doe"@example.com')).toBe(true);
    });
  });

  describe("invalid emails", () => {
    it("should reject emails without @", () => {
      expect(validateEmail("userexample.com")).toBe(false);
      expect(validateEmail("invalid")).toBe(false);
    });

    it("should reject emails without local part", () => {
      expect(validateEmail("@example.com")).toBe(false);
    });

    it("should reject emails without domain", () => {
      expect(validateEmail("user@")).toBe(false);
      expect(validateEmail("test@.com")).toBe(false);
    });

    it("should reject emails with spaces", () => {
      expect(validateEmail("user @example.com")).toBe(false);
      expect(validateEmail("user@ example.com")).toBe(false);
      expect(validateEmail("user@example .com")).toBe(false);
    });

    it("should reject emails with multiple @", () => {
      expect(validateEmail("user@@example.com")).toBe(false);
      expect(validateEmail("user@domain@example.com")).toBe(false);
    });

    it("should reject non-string inputs", () => {
      expect(validateEmail(malformed(null))).toBe(false);
      expect(validateEmail(malformed(undefined))).toBe(false);
      expect(validateEmail(malformed(123))).toBe(false);
      expect(validateEmail(malformed({}))).toBe(false);
    });

    it("should reject empty string", () => {
      expect(validateEmail("")).toBe(false);
    });

    it("should reject emails with invalid TLD", () => {
      expect(validateEmail("user@example.c")).toBe(false);
    });
  });
});

describe("validateFolderName", () => {
  describe("valid folder names", () => {
    it("should accept standard folder names", () => {
      expect(validateFolderName("My Folder")).toBe(true);
      expect(validateFolderName("Dashboard")).toBe(true);
      expect(validateFolderName("Reports 2024")).toBe(true);
    });

    it("should accept folder names with special characters", () => {
      expect(validateFolderName("Project-Alpha")).toBe(true);
      expect(validateFolderName("Team_Data")).toBe(true);
    });

    it("should accept folder names up to 20 characters", () => {
      expect(validateFolderName("12345678901234567890")).toBe(true);
      expect(validateFolderName("A")).toBe(true);
    });
  });

  describe("invalid folder names", () => {
    it("should reject reserved name 'root'", () => {
      expect(validateFolderName("root")).toBe(false);
    });

    it("should reject reserved name 'New folder'", () => {
      expect(validateFolderName("New folder")).toBe(false);
    });

    it("should reject folder names longer than 20 characters", () => {
      expect(validateFolderName("123456789012345678901")).toBe(false);
      expect(validateFolderName("This is a very long folder name")).toBe(false);
    });

    it("should reject empty strings", () => {
      // Empty string is falsy, so validateFolderName returns falsy value
      expect(!!validateFolderName("")).toBe(false);
    });

    it("should handle null/undefined as falsy", () => {
      // validateFolderName returns falsy for null/undefined due to && short-circuit
      expect(!!validateFolderName(malformed(null))).toBe(false);
      expect(!!validateFolderName(malformed(undefined))).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle exactly 20 character names", () => {
      expect(validateFolderName("12345678901234567890")).toBe(true);
    });

    it("should handle names similar to reserved names", () => {
      expect(validateFolderName("Root")).toBe(true);
      expect(validateFolderName("ROOT")).toBe(true);
      expect(validateFolderName("new folder")).toBe(true);
      expect(validateFolderName("New Folder")).toBe(true);
    });
  });
});
