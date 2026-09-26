import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

/**
 * `cn()` is tailwind-merge over clsx. Stock tailwind-merge doesn't know our custom font sizes
 * (`text-button`, `text-body-small`, ...), read them as text COLOURS, and dropped the size
 * whenever a real colour class followed in the same call: buttons shipped at the inherited 16px
 * regular instead of the token's 14px semibold, and a change note came out at 16px.
 */
describe("cn", () => {
  it("keeps a custom font size next to a colour", () => {
    expect(cn("text-button px-3", "text-ink")).toBe("text-button px-3 text-ink");
    expect(cn("text-body-small text-ink-muted")).toBe("text-body-small text-ink-muted");
    expect(cn("text-label uppercase", true && "text-ink-inverse")).toBe(
      "text-label uppercase text-ink-inverse"
    );
  });

  it("lets a later size replace an earlier one, custom or stock", () => {
    expect(cn("text-button", "text-body-small")).toBe("text-body-small");
    expect(cn("text-sm", "text-button")).toBe("text-button");
    expect(cn("text-body", "text-[15px]")).toBe("text-[15px]");
  });

  it("still resolves colour against colour", () => {
    expect(cn("text-ink-muted", "text-ink")).toBe("text-ink");
    expect(cn("text-red-500", "text-ink")).toBe("text-ink");
  });

  it("treats variants separately", () => {
    expect(cn("text-body-small", "lg:text-[13px]")).toBe("text-body-small lg:text-[13px]");
  });
});
