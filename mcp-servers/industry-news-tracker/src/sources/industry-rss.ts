/**
 * Fetches general martech/CDP industry RSS feeds (CDP Institute, MarTech
 * Today, etc.) for the weekly digest. Feed list is intentionally small and
 * curated rather than configurable-by-tool-call, to keep the digest
 * signal-to-noise ratio high.
 */

import Parser from "rss-parser";

export interface IndustryNewsItem {
  source: "industry-rss";
  feedName: string;
  title: string;
  url: string;
  publishedAt: string;
  summary: string;
}

const CURATED_FEEDS: { name: string; url: string }[] = [
  { name: "CDP Institute", url: "https://www.cdpinstitute.org/feed/" },
  { name: "MarTech", url: "https://martech.org/feed/" },
];

const parser = new Parser();

export async function fetchIndustryRss(): Promise<IndustryNewsItem[]> {
  const items: IndustryNewsItem[] = [];

  for (const feed of CURATED_FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const entry of parsed.items ?? []) {
        items.push({
          source: "industry-rss",
          feedName: feed.name,
          title: entry.title ?? "(untitled)",
          url: entry.link ?? "",
          publishedAt: entry.isoDate ?? entry.pubDate ?? "",
          summary: entry.contentSnippet ?? "",
        });
      }
    } catch (err) {
      // A single dead feed shouldn't break the whole digest.
      console.error(`Failed to fetch feed '${feed.name}' (${feed.url}):`, err);
    }
  }

  return items;
}
