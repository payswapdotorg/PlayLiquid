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

export async function GET() {
  const automations = await db.automation.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ automations: automations.map(toDTO) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    prompt?: string;
    schedule?: string;
  };
  const name = (body.name ?? "").trim();
  const prompt = (body.prompt ?? "").trim();
  const schedule = (body.schedule ?? "").trim() || "Manual";
  if (!name || !prompt) {
    return NextResponse.json({ error: "Name and prompt are required" }, { status: 400 });
  }
  const automation = await db.automation.create({
    data: { name: name.slice(0, 80), prompt: prompt.slice(0, 2000), schedule: schedule.slice(0, 80) },
  });
  return NextResponse.json({ automation: toDTO(automation) });
}
