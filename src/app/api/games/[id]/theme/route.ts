import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Save a new theme/build for a game from the Game Builder. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { themeJson?: string; version?: string };
  const game = await db.game.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  const data: { themeJson?: string; updatedAt: Date; version?: string } = { updatedAt: new Date() };
  if (body.themeJson) {
    try {
      JSON.parse(body.themeJson);
      data.themeJson = body.themeJson;
    } catch {
      return NextResponse.json({ error: "Invalid theme JSON" }, { status: 400 });
    }
  }
  if (body.version) data.version = body.version;

  await db.game.update({ where: { id: game.id }, data });
  const updated = await db.game.findUnique({ where: { id: game.id }, select: { version: true, themeJson: true } });
  return NextResponse.json({ game: updated });
}
