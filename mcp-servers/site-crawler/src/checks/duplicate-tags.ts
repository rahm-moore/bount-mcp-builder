/**
 * Detects duplicate tag deployments on a page — e.g. Launch/Tags loaded
 * twice, or a legacy AppMeasurement.js loaded alongside alloy.js in a way
 * that would double-fire hits. Common source of inflated Analytics counts
 * during a Web SDK migration.
 */

import type { Page } from "playwright";

export interface DuplicateTagFinding {
  check: "duplicate-tags";
  duplicatesFound: boolean;
  duplicateScriptSrcs: string[];
  legacyAndAlloyBothPresent: boolean;
  details: string;
}

export async function checkDuplicateTags(page: Page): Promise<DuplicateTagFinding> {
  const scriptSrcs = await page.evaluate(() =>
    Array.from(document.scripts)
      .map((s) => s.src)
      .filter((src) => src.length > 0)
  );

  const seen = new Map<string, number>();
  for (const src of scriptSrcs) {
    // Normalize away cache-busting query params before comparing.
    const normalized = src.split("?")[0];
    seen.set(normalized, (seen.get(normalized) ?? 0) + 1);
  }
  const duplicateScriptSrcs = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([src]) => src);

  const hasLegacy = scriptSrcs.some((src) => /appmeasurement/i.test(src));
  const hasAlloy = scriptSrcs.some((src) => /alloy(\.min)?\.js/i.test(src));

  return {
    check: "duplicate-tags",
    duplicatesFound: duplicateScriptSrcs.length > 0,
    duplicateScriptSrcs,
    legacyAndAlloyBothPresent: hasLegacy && hasAlloy,
    details:
      duplicateScriptSrcs.length > 0
        ? `Found ${duplicateScriptSrcs.length} script(s) loaded more than once.`
        : "No duplicate script loads detected.",
  };
}
