"use client";

import { cn } from "@/lib/utils";

/** PlayLiquid logo — a liquid droplet with a play core. */
export function PlayLiquidLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex select-none items-center gap-2", className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <defs>
          <linearGradient id="pl-drop" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
        <path
          d="M16 2C16 2 6 12.5 6 19.5C6 25.3 10.5 30 16 30C21.5 30 26 25.3 26 19.5C26 12.5 16 2 16 2Z"
          fill="url(#pl-drop)"
        />
        <path d="M13.5 14.2L21 19L13.5 23.8V14.2Z" fill="#0b0f16" />
      </svg>
      <span className="text-lg font-bold tracking-tight">
        Play<span className="pl-brand-text">Liquid</span>
      </span>
    </span>
  );
}
