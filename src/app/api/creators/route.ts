import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Studio rows for the web sidebar (real creators replace the mock list). */
export async function GET() {
  const creators = await db.creator.findMany({
    orderBy: [{ followers: "desc" }, { name: "asc" }],
    take: 8,
    select: {
      id: true,
      handle: true,
      name: true,
      avatarUrl: true,
      verified: true,
      followers: true,
      bio: true,
      isMe: true,
    },
  });
  return NextResponse.json({ creators });
}
