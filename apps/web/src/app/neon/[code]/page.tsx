import { notFound } from "next/navigation";
import NeonGate from "@/components/neon/NeonGate";

export const metadata = { title: "NEON DRIFT arena | How Big?" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const c = code.toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(c)) notFound();
  return <NeonGate code={c} />;
}
