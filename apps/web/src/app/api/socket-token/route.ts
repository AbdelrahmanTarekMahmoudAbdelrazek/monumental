import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { currentUser } from "@/lib/auth";

/**
 * Mints a short-lived HS256 token the socket server verifies, so a signed-in
 * user's results are attributed to their account. Guests get { token: null }.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ token: null });
  const secret = new TextEncoder().encode(process.env.SOCKET_JWT_SECRET ?? "dev-secret-change-me");
  const token = await new SignJWT({ nickname: user.nickname ?? user.name ?? "Player" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret);
  return NextResponse.json({ token, nickname: user.nickname ?? user.name ?? null });
}
