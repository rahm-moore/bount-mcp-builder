/**
 * Detects the alloy.js (Web SDK) version loaded on a page and flags
 * whether it's pinned/stale vs. the latest available release.
 */

import type { Page } from "playwright";

export interface AlloyVersionFinding {
  check: "alloy-version";
  found: boolean;
  version: string | null;
  edgeConfigId: string | null;
  isStale: boolean;
  details: string;
}

/** Adobe publishes releases at github.com/adobe/alloy — kept here as a
 * simple constant rather than a live lookup so this check has no external
 * dependency at audit time. Update when the team upgrades the pinned kit
 * version for client engagements. */
const KNOWN_LATEST_MAJOR = 2;

export async function checkAlloyVersion(page: Page): Promise<AlloyVersionFinding> {
  const result = await page.evaluate(() => {
    const w = window as unknown as {
      alloy?: { VERSION?: string };
      __alloyNS?: string;
    };
    const globalName = w.__alloyNS ?? "alloy";
    const instance = (window as Record<string, unknown>)[globalName] as
      | { VERSION?: string }
      | undefined;
    return {
      version: instance?.VERSION ?? w.alloy?.VERSION ?? null,
    };
  });

  const version = result.version;
  if (!version) {
    return {
      check: "alloy-version",
      found: false,
      version: null,
      edgeConfigId: null,
      isStale: false,
      details: "alloy.js instance not detected on window (checked window.alloy and window[__alloyNS]).",
    };
  }

  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  return {
    check: "alloy-version",
    found: true,
    version,
    edgeConfigId: null,
    isStale: major < KNOWN_LATEST_MAJOR,
    details: `Detected alloy.js v${version}.`,
  };
}
