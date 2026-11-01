import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { PluginStates } from "@/lib/types";

const KEY = "plugin-states";

function parseStates(raw: string | undefined | null): PluginStates {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PluginStates;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

/** Persisted install/enable state per plugin key (catalog stays client-side). */
export async function GET() {
  const row = await db.preference.findUnique({ where: { key: KEY } });
  return NextResponse.json({ states: parseStates(row?.value) });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { states?: PluginStates };
  const incoming = body.states ?? {};

  // interactive transaction: read-merge-write must be atomic (concurrent toggles)
  const merged = await db.$transaction(async (tx) => {
    const row = await tx.preference.findUnique({ where: { key: KEY } });
    const current = parseStates(row?.value);

    const next: PluginStates = { ...current };
    for (const [key, state] of Object.entries(incoming)) {
      if (!state || typeof state !== "object") continue;
      next[key] = {
        installed: Boolean(state.installed),
        enabled: Boolean(state.enabled),
      };
    }

    await tx.preference.upsert({
      where: { key: KEY },
      create: { key: KEY, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });
    return next;
  });

  return NextResponse.json({ states: merged });
}

/** POST alias so clients using the shared postJson helper (POST-only) work. */
export const POST = PUT;
