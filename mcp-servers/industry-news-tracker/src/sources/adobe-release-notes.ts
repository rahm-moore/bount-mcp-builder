/**
 * Fetches Adobe Experience Platform / Web SDK release notes.
 *
 * No API key is required for these public pages, so this source needs no
 * credential-resolver involvement — unlike aep-core and site-crawler,
 * this server holds no secrets at all.
 */

export interface ReleaseNoteItem {
  source: "adobe-release-notes";
  product: string;
  title: string;
  url: string;
  publishedAt: string;
  summary: string;
}

const RELEASE_NOTE_FEEDS: Record<string, string> = {
  "experience-platform": "https://experienceleague.adobe.com/en/docs/experience-platform/release-notes/current.rss",
  "web-sdk": "https://github.com/adobe/alloy/releases.atom",
};

export async function fetchAdobeReleaseNotes(product: keyof typeof RELEASE_NOTE_FEEDS): Promise<ReleaseNoteItem[]> {
  const feedUrl = RELEASE_NOTE_FEEDS[product];
  if (!feedUrl) {
    throw new Error(`Unknown product feed: ${product}. Known: ${Object.keys(RELEASE_NOTE_FEEDS).join(", ")}`);
  }

  throw new NotImplementedYet(
    `wire up an RSS/Atom fetch+parse (via rss-parser) against ${feedUrl} and map ` +
      `entries onto ReleaseNoteItem[]`
  );
}

class NotImplementedYet extends Error {}
