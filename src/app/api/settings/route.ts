import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { SettingsValues } from "@/lib/types";

/**
 * Generic key-value preferences — backs the Settings window (language,
 * interface mode, terminal options…), plugin install states and notification
 * opt-ins. Values are always stored as JSON-encoded strings.
 */
export async function GET() {
  const rows = await db.preference.findMany();
  const values: SettingsValues = {};
  for (const row of rows) {
    try {
      values[row.key] = JSON.parse(row.value) as string;
    } catch {
      values[row.key] = row.value;
    }
  }
  return NextResponse.json({ values });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { values?: SettingsValues };
  const entries = Object.entries(body.values ?? {}).filter(
    ([k, v]) =>
      typeof k === "string" &&
      k.length > 0 &&
      k.length <= 64 &&
      (typeof v === "string" || typeof v === "number" || typeof v === "boolean"),
  );
  if (entries.length === 0) {
    return NextResponse.json({ error: "No valid values provided" }, { status: 400 });
  }

  await db.$transaction(
    entries.map(([key, value]) =>
      db.preference.upsert({
        where: { key },
        create: { key, value: JSON.stringify(value) },
        update: { value: JSON.stringify(value) },
      }),
    ),
  );

  const rows = await db.preference.findMany();
  const values: SettingsValues = {};
  for (const row of rows) {
    try {
      values[row.key] = JSON.parse(row.value) as string;
    } catch {
      values[row.key] = row.value;
    }
  }
  return NextResponse.json({ values });
}

/** POST alias so clients using the shared postJson helper (POST-only) work. */
export const POST = PUT;
