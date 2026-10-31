import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Start (or resume) a play session — increments play count. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const game = await db.game.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  const existing = await db.playSession.findFirst({ where: { gameId: game.id } });
  const session = existing
    ? await db.playSession.update({ where: { id: existing.id }, data: { updatedAt: new Date() } })
    : await db.playSession.create({ data: { gameId: game.id, progress: 0 } });

  await db.game.update({ where: { id: game.id }, data: { plays: { increment: 1 } } });

  return NextResponse.json({ session });
}
