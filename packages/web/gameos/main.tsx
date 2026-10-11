/**
 * GameOS Studio web mount (PL-033). The HOST composition: builds the demo
 * `StudioDataSnapshot` from the REAL sibling systems, wires it behind a
 * `StudioDataPort`, creates the ONE studio store and mounts the React app.
 *
 * This file lives in packages/web/gameos and imports @playliquid/game-ui
 * by RELATIVE SOURCE PATH (../../game-ui/src/index.ts) on purpose: the
 * web package manifest and the TL-frozen pnpm-lock stay untouched; the
 * mount is preview evidence for the work order, not a shipped web feature
 * (the established PL-001..006 flow: TL links the importer at merge time).
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  StudioApp,
  createStudioStore,
  demoStudioSnapshot,
  StaticStudioDataPort,
} from "../../game-ui/src/index.ts";

async function mount(): Promise<void> {
  const rootElement = document.getElementById("studio-root");
  if (rootElement === null) throw new Error("gameos mount: #studio-root element missing");

  // Host responsibility #1: load the FIRST authoritative snapshot before
  // the store exists (the store never renders an invented state, E11).
  const snapshot = await demoStudioSnapshot();

  // Host responsibility #2: wire the data seam. The demo port is a fixed
  // point (lock rule 44: labeled test support, not a production seam) —
  // Refresh therefore performs a REAL port load of the same snapshot.
  const port = new StaticStudioDataPort(snapshot);

  // Host responsibility #3: create the ONE store and mount the app.
  const store = createStudioStore(snapshot, port);
  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <StudioApp store={store} />
    </StrictMode>,
  );
}

mount().catch((error: unknown) => {
  // E11: a failed mount is rendered, never swallowed.
  const rootElement = document.getElementById("studio-root");
  const detail = error instanceof Error ? `${String(error.name)}: ${String(error.message)}` : String(error);
  if (rootElement !== null) {
    rootElement.innerHTML = "";
    const banner = document.createElement("p");
    banner.setAttribute("role", "alert");
    banner.textContent = `Game Studio mount failed (E11): ${detail}`;
    banner.style.cssText =
      "margin:24px;padding:10px 14px;border-radius:8px;color:#f87171;background:rgba(239,68,68,.1);border:1px solid rgba(248,113,113,.4);font-family:ui-monospace,monospace;font-size:12.5px";
    rootElement.append(banner);
  }
  console.error("gameos mount failed", error);
});
