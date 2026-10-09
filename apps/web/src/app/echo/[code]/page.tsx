import { notFound } from "next/navigation";
import EchoGate from "@/components/echo/EchoGate";

export const metadata = { title: "ECHO HALLS room | How Big?" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const c = code.toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(c)) notFound();
  return <EchoGate code={c} />;
}
