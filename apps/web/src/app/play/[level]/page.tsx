import { notFound } from "next/navigation";
import { LEVELS } from "@monumental/shared";
import PlayGate from "@/components/PlayGate";

export function generateStaticParams() {
  return LEVELS.map((l) => ({ level: String(l.id) }));
}

export default async function Page({ params }: { params: Promise<{ level: string }> }) {
  const { level } = await params;
  const id = Number(level);
  if (!LEVELS.some((l) => l.id === id)) notFound();
  return <PlayGate levelId={id} />;
}
