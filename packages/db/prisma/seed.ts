import "dotenv/config";
import { prisma } from "../src/index";
import { MONUMENTS } from "@monumental/shared";



async function main() {
  // Monuments: upsert the built-in catalogue (admin edits are preserved via
  // `update` only touching fields that haven't been customised).
  for (const m of MONUMENTS) {
    await prisma.monument.upsert({
      where: { id: m.id },
      create: {
        id: m.id,
        name: m.name,
        country: m.country,
        heightM: m.heightM,
        heightNote: m.heightNote,
        category: m.category,
        tier: m.tier,
        funFact: m.funFact,
        silhouetteW: m.silhouette.w,
        silhouetteD: m.silhouette.d,
        imageUrl: m.image?.url,
        imageAttribution: m.image?.attribution,
      },
      update: {},
    });
  }
  console.log(`Seeded ${MONUMENTS.length} monuments`);

  // Admin user (promote by email) if ADMIN_EMAIL is set.
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    await prisma.user.upsert({
      where: { email: adminEmail },
      create: { email: adminEmail, role: "ADMIN", nickname: "admin" },
      update: { role: "ADMIN" },
    });
    console.log(`Admin: ${adminEmail}`);
  }

  // A sample hourly tournament for the next hour so the UI isn't empty.
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  const existing = await prisma.tournament.findFirst({ where: { isRecurring: true, startsAt: next } });
  if (!existing) {
    await prisma.tournament.create({
      data: { name: `Hourly Open – ${next.toISOString().slice(11, 16)} UTC`, levelId: 3, startsAt: next, isRecurring: true, status: "REGISTRATION" },
    });
    console.log("Created next hourly tournament");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
