import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, withDb } from "@/lib/db";
import { currentUser } from "@/lib/auth";

const schema = z.object({ guestId: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/).optional(), nickname: z.string().min(2).max(20), inviteCode: z.string().max(12).optional() });

/** POST /api/tournaments/:id/register { guestId?, nickname, inviteCode? } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid registration" }, { status: 400 });
  const { guestId, nickname, inviteCode } = parsed.data;
  const playerKey = user ? `user:${user.id}` : guestId ? `guest:${guestId}` : null;
  if (!playerKey) return NextResponse.json({ error: "Sign in or provide a guest id" }, { status: 400 });

  const t = await withDb(() => prisma.tournament.findUnique({ where: { id } }), null);
  if (!t) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
  if (!["SCHEDULED", "REGISTRATION"].includes(t.status)) return NextResponse.json({ error: "Registration is closed" }, { status: 400 });
  if (t.isPrivate && t.inviteCode !== (inviteCode ?? "").toUpperCase()) return NextResponse.json({ error: "Invalid invite code" }, { status: 403 });

  const entry = await prisma.tournamentEntry.upsert({
    where: { tournamentId_playerKey: { tournamentId: id, playerKey } },
    create: { tournamentId: id, playerKey, userId: user?.id ?? null, nickname: user?.nickname ?? nickname },
    update: { nickname: user?.nickname ?? nickname },
  });
  return NextResponse.json({ ok: true, entry: { id: entry.id, nickname: entry.nickname } });
}

/** DELETE — withdraw */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  const guestId = new URL(req.url).searchParams.get("guestId");
  const playerKey = user ? `user:${user.id}` : guestId ? `guest:${guestId}` : null;
  if (!playerKey) return NextResponse.json({ error: "no identity" }, { status: 400 });
  await withDb(() => prisma.tournamentEntry.deleteMany({ where: { tournamentId: id, playerKey, tournament: { status: { in: ["SCHEDULED", "REGISTRATION"] } } } }), { count: 0 });
  return NextResponse.json({ ok: true });
}
