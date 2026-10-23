/**
 * THE SHELL ICON GLYPHS (UX-001): the 16px stroke vocabulary of the product
 * top bar — one glyph per workspace plus the agent-workspace spark. The
 * glyphs inherit `currentColor` (the button's text color) so idle, hover,
 * and active states stay contrast-correct without per-icon colors; the
 * spark alone carries the accent (the shell's single signature color on
 * the AI & Agents escape hatch).
 *
 * Icons are decorative-visual: every button carries its accessible name as
 * text or aria-label, so the SVGs are aria-hidden (they never replace a
 * label). Inline SVG only — no external assets, deterministic rendering.
 */

import type { ReactNode } from "react";
import { SHELL_SURFACE } from "./shell-tokens.ts";
import type { ShellWorkspaceIcon } from "./shell-workspaces.ts";

/** Shared glyph frame: 16x16, no fill, inherits currentColor. */
function Glyph({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flex: "0 0 auto", display: "block" }}
    >
      {children}
    </svg>
  );
}

/** Game Studio: a package cube (packages are the studio's primary noun). */
export function StudioIcon(): ReactNode {
  return (
    <Glyph>
      <path
        d="M8 1.8 14.2 5.2v5.6L8 14.2 1.8 10.8V5.2Z"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <path
        d="M1.8 5.2 8 8.6l6.2-3.4M8 8.6v5.6"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Glyph>
  );
}

/** Lab: an erlenmeyer flask with a visible liquid level. */
export function LabIcon(): ReactNode {
  return (
    <Glyph>
      <path
        d="M5.8 2.2h4.4M6.6 2.2v3.2L3.2 11a2.7 2.7 0 0 0 2.4 4h4.8a2.7 2.7 0 0 0 2.4-4L9.4 5.4V2.2"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4.6 10.4h6.8" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </Glyph>
  );
}

/** Community: two people (contributions are people's work). */
export function CommunityIcon(): ReactNode {
  return (
    <Glyph>
      <circle cx={5.6} cy={4.6} r={2.1} stroke="currentColor" strokeWidth={1.5} />
      <path
        d="M1.6 13.4c0-2.3 1.8-3.8 4-3.8s4 1.5 4 3.8"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <circle cx={11.4} cy={5.4} r={1.7} stroke="currentColor" strokeWidth={1.5} />
      <path
        d="M11 9.8c2.1.2 3.4 1.6 3.4 3.6"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </Glyph>
  );
}

/** The AI & Agents spark (four-point star) — the one accent glyph. */
export function AgentsSparkIcon(): ReactNode {
  return (
    <Glyph>
      <path
        d="M8 1.6 9.5 6.5 14.4 8 9.5 9.5 8 14.4 6.5 9.5 1.6 8 6.5 6.5Z"
        stroke={SHELL_SURFACE.accent}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </Glyph>
  );
}

/** The workspace icon components, by vocabulary key. */
export const WORKSPACE_ICONS: Record<ShellWorkspaceIcon, () => ReactNode> = Object.freeze({
  studio: StudioIcon,
  lab: LabIcon,
  community: CommunityIcon,
});

/** Renders one workspace's glyph. */
export function WorkspaceIcon({ icon }: { readonly icon: ShellWorkspaceIcon }): ReactNode {
  const GlyphOf = WORKSPACE_ICONS[icon];
  return <GlyphOf />;
}
