"use client";

/**
 * Shared helpers for the reconstruction discovery pages. The design's
 * static game-card and its title→record resolver were retired when the
 * discovery views moved to real API data — only the standard page head
 * remains.
 */

/** Standard page head used by the discovery pages. */
export function PageHead({
  kicker,
  title,
  subtitle,
}: {
  kicker?: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="page-head">
      <div>
        {kicker && <div className="kicker">{kicker}</div>}
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
