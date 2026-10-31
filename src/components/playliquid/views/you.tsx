"use client";

/** You — profile page head + activity placeholder, per the design. */
import { PageHead } from "./design-cards";

export function YouView() {
  return (
    <section aria-label="Your profile">
      <PageHead kicker="Your PlayLiquid profile" title="You" subtitle="Profile, activity and followed studios." />
      <div className="page-empty">Player profile and activity</div>
    </section>
  );
}
