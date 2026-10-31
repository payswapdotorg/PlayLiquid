import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toScoreDTO } from "@/lib/serialize";

/** Submit a leaderboard score. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { score?: number; player?: string };
  const score = Math.max(0, Math.round(body.score ?? 0));
  const game = await db.game.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  await db.score.create({
    data: {
      gameId: game.id,
      player: body.player?.trim() || "You",
      avatar: "/avatars/playliquid-labs.jpg",
      score,
    },
  });
  const leaderboard = await db.score.findMany({
    where: { gameId: game.id },
    orderBy: { score: "desc" },
    take: 10,
  });
  return NextResponse.json({ leaderboard: leaderboard.map(toScoreDTO) });
}
