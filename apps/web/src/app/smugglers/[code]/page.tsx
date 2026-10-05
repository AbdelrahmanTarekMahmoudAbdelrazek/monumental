import { notFound } from "next/navigation";
import SmuggleGate from "@/components/smuggle/SmuggleGate";

export const metadata = { title: "SMUGGLERS game | How Big?" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const c = code.toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(c)) notFound();
  return <SmuggleGate code={c} />;
}
