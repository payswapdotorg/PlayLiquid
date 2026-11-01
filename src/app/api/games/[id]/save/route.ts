import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Save / unsave a game to the server-side Library. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { saved?: boolean };
  const game = await db.game.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  const existing = await db.libraryItem.findFirst({ where: { gameId: game.id } });
  if (body.saved === false) {
    if (existing) await db.libraryItem.delete({ where: { id: existing.id } });
    return NextResponse.json({ saved: false });
  }
  if (!existing) await db.libraryItem.create({ data: { gameId: game.id } });
  return NextResponse.json({ saved: true });
}
