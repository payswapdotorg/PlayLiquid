import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Toggle like/dislike on a game (client-authoritative state, server adjusts count). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { liked?: boolean; disliked?: boolean };
  const game = await db.game.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  if (body.liked !== undefined) {
    await db.game.update({ where: { id: game.id }, data: { likes: { increment: body.liked ? 1 : -1 } } });
  }
  const updated = await db.game.findUnique({ where: { id: game.id }, select: { likes: true } });
  return NextResponse.json({ likes: Math.max(0, updated?.likes ?? 0) });
}
