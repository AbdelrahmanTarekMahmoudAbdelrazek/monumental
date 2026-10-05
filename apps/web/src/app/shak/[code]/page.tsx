import { notFound } from "next/navigation";
import ShakGate from "@/components/shak/ShakGate";

export const metadata = { title: "أشك table | How Big?" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const c = code.toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(c)) notFound();
  return <ShakGate code={c} />;
}
