import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toCommentDTO, toGameDetailDTO, toScoreDTO, toUpdateDTO } from "@/lib/serialize";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const game = await db.game.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    include: {
      creator: true,
      sessions: true,
      _count: { select: { comments: true } },
    },
  });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  const [related, leaderboard, updates, comments] = await Promise.all([
    db.game.findMany({
      where: { status: "published", id: { not: game.id }, OR: [{ category: game.category }, { engine: game.engine }] },
      include: { creator: true, sessions: true, _count: { select: { comments: true } } },
      orderBy: { plays: "desc" },
      take: 8,
    }),
    db.score.findMany({ where: { gameId: game.id }, orderBy: { score: "desc" }, take: 10 }),
    db.gameUpdate.findMany({ where: { gameId: game.id }, orderBy: [{ createdAt: "desc" }] }),
    db.comment.findMany({ where: { gameId: game.id }, orderBy: [{ createdAt: "desc" }], take: 30 }),
  ]);

  return NextResponse.json({
    game: toGameDetailDTO(game),
    related: related.map((g) => toGameDetailDTO(g)),
    leaderboard: leaderboard.map(toScoreDTO),
    updates: updates.map(toUpdateDTO),
    comments: comments.map(toCommentDTO),
  });
}
