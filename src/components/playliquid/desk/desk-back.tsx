"use client";

/**
 * DeskBackButton — the "Back to PlayLiquid" escape hatch, present on every
 * page of the creator workspace (New Task, Automations, Plugin Marketplace,
 * Game Builder). Mirrors the Settings window's back pill styling and hands
 * control back to the web experience.
 *
 * variant="floating" (default) — absolutely positioned pill at the top-left
 * of the desk content column (Automations, Plugins, transient builder states).
 * variant="inline" — static pill that flows inside the Game Builder header.
 */
import { cn } from "@/lib/utils";
import { usePlayLiquid } from "@/lib/store";

export function DeskBackButton({ variant = "floating" }: { variant?: "floating" | "inline" }) {
  const navigate = usePlayLiquid((s) => s.navigate);
  return (
    <button
      type="button"
      className={cn("newtask-back", variant === "inline" && "newtask-back--inline")}
      title="Back to PlayLiquid"
      onClick={() => navigate("home")}
    >
      ‹　<span className="back-label">Back to PlayLiquid</span>
    </button>
  );
}
