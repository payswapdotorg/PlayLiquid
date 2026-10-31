import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toSparkDTO } from "@/lib/serialize";
import type { SparksPageDTO } from "@/lib/types";

const PAGE_SIZE = 5;

export async function GET(req: NextRequest) {
  const cursor = Number(req.nextUrl.searchParams.get("cursor") ?? "0") || 0;
  const sparks = await db.spark.findMany({
    include: { creator: true, game: true, _count: { select: { comments: true } } },
    orderBy: { likes: "desc" },
    skip: cursor,
    take: PAGE_SIZE + 1,
  });
  const hasMore = sparks.length > PAGE_SIZE;
  const dto: SparksPageDTO = {
    sparks: sparks.slice(0, PAGE_SIZE).map(toSparkDTO),
    nextCursor: hasMore ? cursor + PAGE_SIZE : null,
  };
  return NextResponse.json(dto);
}
