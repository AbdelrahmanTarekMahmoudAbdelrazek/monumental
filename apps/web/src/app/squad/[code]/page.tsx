import { notFound } from "next/navigation";
import SquadGate from "@/components/squad/SquadGate";

export const metadata = { title: "SQUAD RUSH room | How Big?" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const c = code.toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(c)) notFound();
  return <SquadGate code={c} />;
}
