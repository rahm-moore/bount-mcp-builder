/**
 * Confirms an expected alloy.js `sendEvent` (or beacon request to the
 * configured Edge Network endpoint) actually fired during a page
 * interaction — the core "did the tag really send data" QA check.
 */

import type { Page } from "playwright";

export interface EventFiredFinding {
  check: "event-fired";
  eventName: string;
  fired: boolean;
  requestUrls: string[];
  details: string;
}

const EDGE_NETWORK_HOST_PATTERN = /\.(data|adobedc)\.net|edge\.adobedc\.net/i;

/**
 * Watches network traffic for a matching Edge Network request while the
 * given interaction runs, then reports whether it fired.
 */
export async function checkEventFired(
  page: Page,
  eventName: string,
  triggerInteraction: () => Promise<void>,
  timeoutMs = 5000
): Promise<EventFiredFinding> {
  const requestUrls: string[] = [];

  const onRequest = (request: { url(): string }) => {
    const url = request.url();
    if (EDGE_NETWORK_HOST_PATTERN.test(url)) {
      requestUrls.push(url);
    }
  };

  page.on("request", onRequest);
  try {
    await Promise.race([
      triggerInteraction(),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    // Give in-flight beacons a brief window to land after the interaction.
    await page.waitForTimeout(500);
  } finally {
    page.off("request", onRequest);
  }

  return {
    check: "event-fired",
    eventName,
    fired: requestUrls.length > 0,
    requestUrls,
    details:
      requestUrls.length > 0
        ? `Observed ${requestUrls.length} Edge Network request(s) for event '${eventName}'.`
        : `No Edge Network request observed for event '${eventName}' within ${timeoutMs}ms.`,
  };
}
