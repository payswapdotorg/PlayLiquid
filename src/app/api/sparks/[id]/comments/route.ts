import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toCommentDTO } from "@/lib/serialize";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const comments = await db.comment.findMany({
    where: { sparkId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ comments: comments.map(toCommentDTO) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { body?: string; author?: string };
  const text = (body.body ?? "").trim();
  if (!text) return NextResponse.json({ error: "Comment body required" }, { status: 400 });
  const spark = await db.spark.findUnique({ where: { id } });
  if (!spark) return NextResponse.json({ error: "Spark not found" }, { status: 404 });

  const comment = await db.comment.create({
    data: {
      sparkId: id,
      authorName: body.author?.trim() || "You",
      authorAvatar: "/avatars/playliquid-labs.jpg",
      body: text.slice(0, 1000),
    },
  });
  return NextResponse.json({ comment: toCommentDTO(comment) });
}
