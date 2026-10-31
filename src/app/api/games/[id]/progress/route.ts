import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Update continue-playing progress + last score for a session. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { progress?: number; score?: number };
  const game = await db.game.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  const progress = Math.max(0, Math.min(1, body.progress ?? 0));
  const score = Math.max(0, Math.round(body.score ?? 0));

  const existing = await db.playSession.findFirst({ where: { gameId: game.id } });
  const session = existing
    ? await db.playSession.update({
        where: { id: existing.id },
        data: { progress, lastScore: Math.max(existing.lastScore, score), updatedAt: new Date() },
      })
    : await db.playSession.create({ data: { gameId: game.id, progress, lastScore: score } });

  return NextResponse.json({ session });
}
