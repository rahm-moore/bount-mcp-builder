/**
 * News page — renders the weekly digest from industry-news-tracker.
 */

async function getDigest() {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
  try {
    const res = await fetch(`${backendUrl}/api/news/digest`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as { markdown: string; generatedAt: string };
  } catch {
    return null;
  }
}

export default async function NewsPage() {
  const digest = await getDigest();

  return (
    <main>
      <h1>Industry News</h1>
      {digest ? (
        <article>
          <p>Generated at {digest.generatedAt}</p>
          <pre>{digest.markdown}</pre>
        </article>
      ) : (
        <p>No digest available. Is the industry-news-tracker server running?</p>
      )}
    </main>
  );
}
