/**
 * THE WORKSPACE NAVIGATION VOCABULARY (RW-001, frozen by UX-001): the three
 * product workspaces of the PlayLiquid GameOS shell, in display order, with
 * their frozen labels ("Game Studio" / "Lab" / "Community") and honest
 * hints. Pure module: no IO, no JSX, no React — the vocabulary is data the
 * chrome renders and the tests pin (the frozen cross-workstream contract in
 * spec/ux/work-items.md asserts exactly these labels and the
 * `gameos-nav-<id>` marker pattern).
 */

/** One navigable product workspace of the shell. */
export type ShellWorkspaceId = "studio" | "lab" | "community";

/** The icon key of a workspace (rendered by shell-icons.tsx). */
export type ShellWorkspaceIcon = "studio" | "lab" | "community";

/** One workspace's navigation vocabulary (frozen labels + honest hints). */
export interface ShellWorkspace {
  readonly id: ShellWorkspaceId;
  readonly label: string;
  readonly hint: string;
  readonly icon: ShellWorkspaceIcon;
}

/**
 * The workspace navigation vocabulary (order = display order = Tab order).
 * Labels are FROZEN by the UX-001 cross-workstream contract; hints state
 * honestly what each workspace contains (they become the buttons' title
 * tooltips and, in icon-only bar densities, part of the aria-label).
 */
export const SHELL_WORKSPACES: readonly ShellWorkspace[] = Object.freeze([
  {
    id: "studio",
    label: "Game Studio",
    hint: "Packages, runtime sessions, avatars, capabilities, tools",
    icon: "studio",
  },
  {
    id: "lab",
    label: "Lab",
    hint: "Searches, evidence, learning, guidance, capability gaps, Arena",
    icon: "lab",
  },
  {
    id: "community",
    label: "Community",
    hint: "Contributions, lifecycle, provenance",
    icon: "community",
  },
] as const);
