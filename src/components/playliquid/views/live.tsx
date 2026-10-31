"use client";

/** Live — live worlds, creators and community sessions, per the design. */
import { PageHead } from "./design-cards";

export function LiveView() {
  return (
    <section aria-label="Live">
      <PageHead title="Live" subtitle="Live worlds, creators and community sessions." />
      <div className="page-empty">Live experiences</div>
    </section>
  );
}
