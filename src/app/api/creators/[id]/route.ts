import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toCommentDTO, toGameDTO, toSparkDTO } from "@/lib/serialize";
import type { ChannelDTO } from "@/lib/types";

const GAME_INCLUDE = {
  creator: true,
  sessions: true,
  _count: { select: { comments: true } },
} as const;

/**
 * Creator channel payload — resolves by id, handle ("@name") or display name
 * (the sidebar navigates by display name). Powers the channel page: banner,
 * identity, videos (games), shorts (sparks), stats and community comments.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  const creator = await db.creator.findFirst({
    where: {
      OR: [{ id: decoded }, { handle: decoded }, { handle: `@${decoded}` }, { name: decoded }],
    },
  });
  if (!creator) return NextResponse.json({ error: "Creator not found" }, { status: 404 });

  const [games, sparks, recentComments] = await Promise.all([
    db.game.findMany({
      where: { creatorId: creator.id, status: "published" },
      include: GAME_INCLUDE,
      orderBy: { createdAt: "desc" },
    }),
    db.spark.findMany({
      where: { creatorId: creator.id },
      include: { creator: true, game: true, _count: { select: { comments: true } } },
      orderBy: { likes: "desc" },
    }),
    db.comment.findMany({
      where: { game: { creatorId: creator.id } },
      include: { game: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const dto: ChannelDTO = {
    creator: {
      id: creator.id,
      handle: creator.handle,
      name: creator.name,
      avatarUrl: creator.avatarUrl,
      verified: creator.verified,
      followers: creator.followers,
      bio: creator.bio,
      isMe: creator.isMe,
    },
    games: games.map((g) => toGameDTO(g)),
    sparks: sparks.map((s) => toSparkDTO(s)),
    stats: {
      videos: games.length,
      sparks: sparks.length,
      followers: creator.followers,
      totalPlays: games.reduce((a, g) => a + g.plays, 0),
      totalLikes: games.reduce((a, g) => a + g.likes, 0),
      joinedAt: creator.createdAt.toISOString(),
    },
    recentComments: recentComments.map((c) => ({
      ...toCommentDTO(c),
      gameTitle: c.game?.title ?? "",
    })),
  };
  return NextResponse.json(dto);
}
