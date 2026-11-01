import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toGameDTO } from "@/lib/serialize";
import type { GamesPageDTO } from "@/lib/types";

const PAGE_SIZE = 9;

export async function GET(req: NextRequest) {
  const cursor = Number(req.nextUrl.searchParams.get("cursor") ?? "0") || 0;
  const category = req.nextUrl.searchParams.get("category");
  const q = req.nextUrl.searchParams.get("q")?.trim();

  const games = await db.game.findMany({
    where: {
      status: "published",
      ...(category && category !== "All" ? { category } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { description: { contains: q } },
              { longDescription: { contains: q } },
              { tags: { contains: q } },
              { category: { contains: q } },
              { creator: { name: { contains: q } } },
            ],
          }
        : {}),
    },
    include: { creator: true, sessions: true, _count: { select: { comments: true } } },
    orderBy: [{ plays: "desc" }, { createdAt: "asc" }],
    skip: cursor,
    take: PAGE_SIZE + 1,
  });

  const hasMore = games.length > PAGE_SIZE;
  const page = games.slice(0, PAGE_SIZE);
  const dto: GamesPageDTO = {
    games: page.map((g) => toGameDTO(g)),
    nextCursor: hasMore ? cursor + PAGE_SIZE : null,
  };
  return NextResponse.json(dto);
}
