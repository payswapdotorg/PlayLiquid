import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { liked?: boolean };
  await db.spark.update({ where: { id }, data: { likes: { increment: body.liked ? 1 : -1 } } });
  const spark = await db.spark.findUnique({ where: { id }, select: { likes: true } });
  return NextResponse.json({ likes: Math.max(0, spark?.likes ?? 0) });
}
