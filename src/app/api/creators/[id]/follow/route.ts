import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { following?: boolean };
  await db.creator.update({ where: { id }, data: { followers: { increment: body.following ? 1 : -1 } } });
  const creator = await db.creator.findUnique({ where: { id }, select: { followers: true } });
  return NextResponse.json({ followers: Math.max(0, creator?.followers ?? 0) });
}
