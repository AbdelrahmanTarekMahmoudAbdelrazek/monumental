import { notFound } from "next/navigation";
import PlayGate from "@/components/PlayGate";

/** Short invite links for host-run rooms: /r/ABC123 → room c:ABC123. */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const c = code.toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(c)) notFound();
  return <PlayGate roomId={`c:${c}`} />;
}
