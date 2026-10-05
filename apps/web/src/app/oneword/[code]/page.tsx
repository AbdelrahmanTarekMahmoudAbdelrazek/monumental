import { notFound } from "next/navigation";
import OneWordGate from "@/components/oneword/OneWordGate";

export const metadata = { title: "ONE WORD game | How Big?" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const c = code.toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(c)) notFound();
  return <OneWordGate code={c} />;
}
