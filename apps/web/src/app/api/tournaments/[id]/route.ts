import { NextResponse } from "next/server";
import { prisma, withDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await withDb(
    () => prisma.tournament.findUnique({ where: { id }, include: { entries: { orderBy: [{ finalRank: "asc" }, { qualifyingPoints: "desc" }] } } }),
    null,
  );
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ tournament: { ...t, inviteCode: undefined, entries: t.entries.map((e) => ({ ...e, userId: undefined })) } });
}
