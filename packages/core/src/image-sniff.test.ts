import { describe, expect, it } from "vitest";
import { sniffImageType } from "./image-sniff";

const bytes = (...n: number[]) => Uint8Array.from(n);
const text = (s: string) => new TextEncoder().encode(s);

describe("sniffImageType", () => {
  it("recognizes PNG, JPEG, GIF and WebP by signature", () => {
    expect(
      sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)),
    ).toBe("image/png");
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(text("GIF89a...."))).toBe("image/gif");
    expect(sniffImageType(text("GIF87a...."))).toBe("image/gif");
    expect(
      sniffImageType(
        Uint8Array.from([...text("RIFF"), 0, 0, 0, 0, ...text("WEBPVP8 ")]),
      ),
    ).toBe("image/webp");
  });
  it("rejects SVG, HTML, scripts, empty and truncated input", () => {
    for (const bad of [
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      "<html><script>alert(1)</script>",
      "<?xml version='1.0'?><svg/>",
      "GIF8",
      "",
      "MZ\u0090\u0000",
    ]) {
      expect(sniffImageType(text(bad)), bad).toBeNull();
    }
    expect(sniffImageType(bytes(0x89, 0x50))).toBeNull();
  });
  it("is not fooled by an image signature followed by a script (still an image to us; served with nosniff + CSP)", () => {
    expect(
      sniffImageType(
        Uint8Array.from([0xff, 0xd8, 0xff, ...text("<script>alert(1)</script>")]),
      ),
    ).toBe("image/jpeg");
  });
});
