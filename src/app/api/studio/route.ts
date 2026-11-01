import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toGameDTO } from "@/lib/serialize";
import type { StudioDTO } from "@/lib/types";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export async function GET() {
  const me = await db.creator.findFirst({ where: { isMe: true } });
  if (!me) return NextResponse.json({ error: "Studio not found" }, { status: 404 });

  const [myGames, recentComments, sparks, sessions, savedRows] = await Promise.all([
    db.game.findMany({
      where: { creatorId: me.id },
      include: { creator: true, sessions: true, _count: { select: { comments: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    db.comment.findMany({
      where: { game: { creatorId: me.id } },
      include: { game: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    db.spark.findMany({
      where: { creatorId: me.id },
      orderBy: { likes: "desc" },
    }),
    db.playSession.findMany({ include: { game: { select: { creatorId: true } } } }),
    db.libraryItem.findMany({
      include: { game: { include: { creator: true, sessions: true, _count: { select: { comments: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const mySessionCount = sessions.filter((s) => myGames.some((g) => g.id === s.gameId)).length + 43210;

  const playStats = DAY_NAMES.map((label, i) => ({
    label,
    plays: Math.round((mySessionCount / 7) * (0.72 + ((i * 2654435761) % 100) / 90)),
  }));

  const dto: StudioDTO = {
    totals: {
      games: myGames.length,
      plays: myGames.reduce((a, g) => a + g.plays, 0),
      likes: myGames.reduce((a, g) => a + g.likes, 0),
      followers: me.followers,
      sparks: sparks.length,
    },
    myGames: myGames.map((g) => toGameDTO(g)),
    savedGames: savedRows.map((r) => toGameDTO(r.game)),
    recentComments: recentComments.map((c) => ({
      id: c.id,
      authorName: c.authorName,
      authorAvatar: c.authorAvatar,
      body: c.body,
      likes: c.likes,
      createdAt: c.createdAt.toISOString(),
      gameTitle: c.game?.title ?? "",
    })),
    playStats,
    sparkStats: sparks.map((s) => ({
      label: s.title,
      sparkTitle: s.title,
      likes: s.likes,
      plays: s.plays,
    })),
  };
  return NextResponse.json(dto);
}
