import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { AutomationDTO } from "@/lib/types";

function toDTO(a: {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  lastRunAt: Date | null;
  createdAt: Date;
}): AutomationDTO {
  return {
    id: a.id,
    name: a.name,
    prompt: a.prompt,
    schedule: a.schedule,
    enabled: a.enabled,
    lastRunAt: a.lastRunAt ? a.lastRunAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Update an automation (rename, reschedule, enable/disable, or mark a manual run). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    prompt?: string;
    schedule?: string;
    enabled?: boolean;
    markRun?: boolean;
  };
  const existing = await db.automation.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Automation not found" }, { status: 404 });

  const data: Partial<{ name: string; prompt: string; schedule: string; enabled: boolean; lastRunAt: Date }> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 80);
  if (typeof body.prompt === "string" && body.prompt.trim()) data.prompt = body.prompt.trim().slice(0, 2000);
  if (typeof body.schedule === "string" && body.schedule.trim()) data.schedule = body.schedule.trim().slice(0, 80);
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (body.markRun) data.lastRunAt = new Date();

  const automation = await db.automation.update({ where: { id }, data });
  return NextResponse.json({ automation: toDTO(automation) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await db.automation.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  await db.automation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
