import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, withDb } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { MONUMENTS } from "@monumental/shared";

export const dynamic = "force-dynamic";

const schema = z.object({
  id: z.string().regex(/^[a-z0-9_]{2,40}$/),
  name: z.string().min(2).max(80),
  country: z.string().min(2).max(60),
  heightM: z.number().positive().max(1e13),
  heightNote: z.string().max(300).default(""),
  category: z.enum(["ancient", "religious", "tower", "statue", "skyscraper", "bridge", "landmark", "animal", "nature", "vehicle", "space"]),
  tier: z.number().int().min(1).max(4),
  funFact: z.string().max(400).default(""),
  silhouetteW: z.number().positive().max(2000).default(30),
  silhouetteD: z.string().max(20000).default(""),
  imageUrl: z.string().url().optional().nullable(),
  imageAttribution: z.string().max(300).optional().nullable(),
  enabled: z.boolean().default(true),
});

async function guard() {
  try { await requireAdmin(); return null; } catch (r) { return r as Response; }
}

/** GET — merged list (DB rows over built-ins) with a flag for which are customised. */
export async function GET() {
  const denied = await guard(); if (denied) return denied;
  const rows = await withDb(() => prisma.monument.findMany({ orderBy: { name: "asc" } }), []);
  const dbIds = new Set(rows.map((r) => r.id));
  const builtins = MONUMENTS.filter((m) => !dbIds.has(m.id)).map((m) => ({
    id: m.id, name: m.name, country: m.country, heightM: m.heightM, heightNote: m.heightNote, category: m.category, tier: m.tier, funFact: m.funFact,
    silhouetteW: m.silhouette.w, silhouetteD: m.silhouette.d, imageUrl: null, imageAttribution: null, enabled: true, source: "builtin" as const,
  }));
  return NextResponse.json({ monuments: [...rows.map((r) => ({ ...r, source: "db" as const })), ...builtins].sort((a, b) => a.name.localeCompare(b.name)) });
}

/** POST / PUT — upsert */
export async function POST(req: Request) {
  const denied = await guard(); if (denied) return denied;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid monument", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  const row = await prisma.monument.upsert({ where: { id: d.id }, create: d, update: d });
  return NextResponse.json({ monument: row });
}
export const PUT = POST;

/** DELETE ?id=… — removes a DB override (built-ins fall back to the dataset; to hide a built-in, upsert with enabled=false). */
export async function DELETE(req: Request) {
  const denied = await guard(); if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  await prisma.monument.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
