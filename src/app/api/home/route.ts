import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toGameDTO, toSparkDTO } from "@/lib/serialize";
import type { HomeDTO } from "@/lib/types";

const GAME_INCLUDE = {
  creator: true,
  sessions: true,
  _count: { select: { comments: true } },
} as const;

export async function GET() {
  const [continueSessions, published, sparks] = await Promise.all([
    db.playSession.findMany({
      orderBy: { updatedAt: "desc" },
      include: { game: { include: GAME_INCLUDE } },
      take: 8,
    }),
    db.game.findMany({
      where: { status: "published" },
      include: GAME_INCLUDE,
      orderBy: { plays: "desc" },
    }),
    db.spark.findMany({
      include: { creator: true, game: true, _count: { select: { comments: true } } },
      orderBy: { likes: "desc" },
    }),
  ]);

  const continuePlaying = continueSessions
    .map((s) => toGameDTO({ ...s.game, sessions: [s] }))
    .filter((g) => (g.progress ?? 0) > 0.02);

  const trending = [...published]
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 8)
    .map((g) => toGameDTO(g));

  const featured = trending.slice(0, 3);
  const recommended = [...published].sort(
    (a, b) => b.likes / (b.plays + 1) - a.likes / (a.plays + 1),
  );
  const live = published.filter((g) => g.isLive);
  const categories = Array.from(new Set(published.map((g) => g.category))).sort();

  const dto: HomeDTO = {
    continuePlaying,
    featured,
    recommended,
    trending,
    live,
    sparks: sparks.map((s) => toSparkDTO(s)),
    categories,
  };
  return NextResponse.json(dto);
}
