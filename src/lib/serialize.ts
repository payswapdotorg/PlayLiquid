import type { Prisma } from "@prisma/client";
import type {
  CommentDTO,
  GameDTO,
  GameDetailDTO,
  ScoreDTO,
  SparkDTO,
  UpdateDTO,
} from "@/lib/types";

type GameWithCreator = Prisma.GameGetPayload<{ include: { creator: true; sessions: true } }>;
type GameFull = Prisma.GameGetPayload<{
  include: { creator: true; sessions: true; _count: { select: { comments: true } } };
}>;
type SparkFull = Prisma.SparkGetPayload<{
  include: { creator: true; game: true; _count: { select: { comments: true } } };
}>;

export function toGameDTO(g: GameWithCreator): GameDTO {
  const session = g.sessions[0];
  return {
    id: g.id,
    slug: g.slug,
    title: g.title,
    description: g.description,
    thumbnailUrl: g.thumbnailUrl,
    previewUrl: g.previewUrl,
    engine: g.engine,
    creator: {
      id: g.creator.id,
      handle: g.creator.handle,
      name: g.creator.name,
      avatarUrl: g.creator.avatarUrl,
      verified: g.creator.verified,
      followers: g.creator.followers,
      bio: g.creator.bio,
      isMe: g.creator.isMe,
    },
    category: g.category,
    tags: g.tags ? g.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    plays: g.plays,
    likes: g.likes,
    rating: g.rating,
    durationMin: g.durationMin,
    isLive: g.isLive,
    isUpcoming: g.isUpcoming,
    version: g.version,
    multiplayer: g.multiplayer,
    controllers: g.controllers,
    status: g.status,
    updatedAt: g.updatedAt.toISOString(),
    ...(session
      ? { progress: session.progress, lastScore: session.lastScore }
      : {}),
  };
}

export function toGameDetailDTO(g: GameFull): GameDetailDTO {
  const base = toGameDTO(g);
  let theme = {} as GameDetailDTO["theme"];
  let scenes = { scenes: [], assets: [], avatars: [] } as GameDetailDTO["scenes"];
  try {
    theme = JSON.parse(g.themeJson);
  } catch {
    /* keep empty */
  }
  try {
    scenes = JSON.parse(g.scenesJson);
  } catch {
    /* keep empty */
  }
  return {
    ...base,
    longDescription: g.longDescription,
    theme,
    scenes,
  };
}

export function toSparkDTO(s: SparkFull): SparkDTO {
  return {
    id: s.id,
    title: s.title,
    caption: s.caption,
    videoUrl: s.videoUrl,
    likes: s.likes,
    plays: s.plays,
    challenge: s.challenge,
    creator: {
      id: s.creator.id,
      handle: s.creator.handle,
      name: s.creator.name,
      avatarUrl: s.creator.avatarUrl,
      verified: s.creator.verified,
      followers: s.creator.followers,
      bio: s.creator.bio,
      isMe: s.creator.isMe,
    },
    game: s.game
      ? { id: s.game.id, title: s.game.title, slug: s.game.slug, engine: s.game.engine }
      : null,
    commentCount: s._count.comments,
  };
}

export function toCommentDTO(c: {
  id: string;
  authorName: string;
  authorAvatar: string;
  body: string;
  likes: number;
  createdAt: Date;
}): CommentDTO {
  return {
    id: c.id,
    authorName: c.authorName,
    authorAvatar: c.authorAvatar,
    body: c.body,
    likes: c.likes,
    createdAt: c.createdAt.toISOString(),
  };
}

export function toScoreDTO(s: {
  id: string;
  player: string;
  avatar: string;
  score: number;
}): ScoreDTO {
  return { id: s.id, player: s.player, avatar: s.avatar, score: s.score };
}

export function toUpdateDTO(u: {
  id: string;
  version: string;
  title: string;
  body: string;
  createdAt: Date;
}): UpdateDTO {
  return { ...u, createdAt: u.createdAt.toISOString() };
}
