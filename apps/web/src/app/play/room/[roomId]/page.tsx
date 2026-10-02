import PlayGate from "@/components/PlayGate";

/** Private rooms (p:CODE:level) and tournament rooms (t:id:q1 / t:id:final). */
export default async function Page({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <PlayGate roomId={decodeURIComponent(roomId)} />;
}
