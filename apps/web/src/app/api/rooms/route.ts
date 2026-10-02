import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Proxy of the socket server's live overview (avoids CORS/mixed-content issues on some hosts). */
export async function GET() {
  const base = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";
  try {
    const r = await fetch(`${base}/rooms`, { cache: "no-store" });
    return NextResponse.json(await r.json());
  } catch {
    return NextResponse.json({ levels: [], rooms: 0, offline: true });
  }
}
