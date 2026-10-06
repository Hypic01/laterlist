import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync("web/app/index.html", "utf8");
const manifest = JSON.parse(readFileSync("web/public/app/manifest.webmanifest", "utf8"));

describe("Home Screen install", () => {
  it("links the manifest and the iOS standalone tags", () => {
    expect(html).toContain('<link rel="manifest" href="/app/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/app/icons/apple-touch-icon.png" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Laterlist" />');
    expect(html).toContain("viewport-fit=cover");
  });

  it("scopes the app to the whole origin so the Google return stays inside it", () => {
    expect(manifest.scope).toBe("/");
    expect(manifest.start_url).toBe("/app/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBe("#191919");
  });

  it("ships every icon the manifest and the page point to", () => {
    for (const icon of manifest.icons) {
      expect(existsSync(`web/public${icon.src}`), icon.src).toBe(true);
    }
    expect(existsSync("web/public/app/icons/apple-touch-icon.png")).toBe(true);
  });
});
