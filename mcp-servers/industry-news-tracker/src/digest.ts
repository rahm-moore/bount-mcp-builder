/**
 * Builds a weekly digest combining Adobe release notes + curated industry
 * RSS items into a single Markdown summary suitable for posting to Slack
 * or the web-ui news page.
 */

import type { ReleaseNoteItem } from "./sources/adobe-release-notes.js";
import type { IndustryNewsItem } from "./sources/industry-rss.js";
import { fetchIndustryRss } from "./sources/industry-rss.js";

export interface WeeklyDigest {
  generatedAt: string;
  windowDays: number;
  releaseNotes: ReleaseNoteItem[];
  industryNews: IndustryNewsItem[];
  markdown: string;
}

function withinWindow(publishedAt: string, windowDays: number): boolean {
  if (!publishedAt) return false;
  const published = new Date(publishedAt).getTime();
  if (Number.isNaN(published)) return false;
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  return published >= cutoff;
}

function toMarkdown(releaseNotes: ReleaseNoteItem[], industryNews: IndustryNewsItem[]): string {
  const lines: string[] = ["# Weekly AEP / Web SDK Digest", ""];

  lines.push("## Adobe Release Notes", "");
  if (releaseNotes.length === 0) {
    lines.push("_No release note updates this week._");
  } else {
    for (const item of releaseNotes) {
      lines.push(`- **${item.product}**: [${item.title}](${item.url}) — ${item.summary}`);
    }
  }

  lines.push("", "## Industry News", "");
  if (industryNews.length === 0) {
    lines.push("_No industry news items this week._");
  } else {
    for (const item of industryNews) {
      lines.push(`- **${item.feedName}**: [${item.title}](${item.url})`);
    }
  }

  return lines.join("\n");
}

export async function buildWeeklyDigest(windowDays = 7): Promise<WeeklyDigest> {
  // Release notes source is still a stub (see adobe-release-notes.ts) —
  // digest generation tolerates it failing so industry news still ships.
  let releaseNotes: ReleaseNoteItem[] = [];
  try {
    const { fetchAdobeReleaseNotes } = await import("./sources/adobe-release-notes.js");
    releaseNotes = await fetchAdobeReleaseNotes("web-sdk");
  } catch {
    releaseNotes = [];
  }

  const allIndustryNews = await fetchIndustryRss();
  const industryNews = allIndustryNews.filter((item) => withinWindow(item.publishedAt, windowDays));
  const filteredReleaseNotes = releaseNotes.filter((item) => withinWindow(item.publishedAt, windowDays));

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    releaseNotes: filteredReleaseNotes,
    industryNews,
    markdown: toMarkdown(filteredReleaseNotes, industryNews),
  };
}
