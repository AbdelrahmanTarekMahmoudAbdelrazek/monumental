import { MONUMENTS, type Monument, type MonumentCategory, type DifficultyTier } from "@monumental/shared";
import { getPrisma } from "./persistence.js";

/**
 * The monument catalogue the game plays with. Built-in dataset, overlaid with
 * rows from the `Monument` table (admin additions / edits / disables).
 * Refreshed every few minutes so admin changes show up without a restart.
 */
let catalog: Monument[] = [...MONUMENTS];
let byId: Map<string, Monument> = new Map(catalog.map((m) => [m.id, m]));

export function getCatalog(): Monument[] {
  return catalog;
}
export function getMonumentById(id: string): Monument | undefined {
  return byId.get(id);
}

export async function refreshCatalog(): Promise<void> {
  const prisma = getPrisma();
  if (!prisma) return;
  try {
    const rows = await prisma.monument.findMany();
    if (rows.length === 0) return;
    const merged = new Map<string, Monument>(MONUMENTS.map((m) => [m.id, m]));
    for (const r of rows) {
      if (!r.enabled) { merged.delete(r.id); continue; }
      const builtin = MONUMENTS.find((m) => m.id === r.id);
      merged.set(r.id, {
        id: r.id,
        name: r.name,
        country: r.country,
        heightM: r.heightM,
        heightNote: r.heightNote,
        measure: builtin?.measure,
        category: r.category as MonumentCategory,
        tier: Math.min(4, Math.max(1, r.tier)) as DifficultyTier,
        funFact: r.funFact,
        silhouette: r.silhouetteD ? { w: r.silhouetteW, d: r.silhouetteD } : builtin?.silhouette ?? { w: 30, d: "M0,0 L30,0 L30,100 L0,100 Z" },
        image: r.imageUrl ? { url: r.imageUrl, attribution: r.imageAttribution ?? "" } : builtin?.image,
      });
    }
    catalog = [...merged.values()];
    byId = new Map(catalog.map((m) => [m.id, m]));
    console.log(`[catalog] ${catalog.length} monuments (${rows.length} db rows)`);
  } catch (e) {
    console.error("[catalog] refresh failed", (e as Error).message);
  }
}
