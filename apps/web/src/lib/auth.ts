import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@monumental/db";

const providers: NextAuthConfig["providers"] = [];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET }));
}
if (process.env.EMAIL_SERVER && process.env.EMAIL_FROM) {
  providers.push(Nodemailer({ server: process.env.EMAIL_SERVER, from: process.env.EMAIL_FROM }));
}

export const authEnabled = providers.length > 0 && !!process.env.DATABASE_URL;

const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers,
  session: { strategy: "database" },
  pages: { signIn: "/auth/signin" },
  trustHost: true,
  events: {
    async createUser({ user }) {
      if (user.email && adminEmails.includes(user.email.toLowerCase())) {
        await prisma.user.update({ where: { id: user.id! }, data: { role: "ADMIN" } });
      }
    },
  },
  callbacks: {
    async session({ session, user }) {
      const u = user as unknown as { id: string; role?: "PLAYER" | "ADMIN"; nickname?: string | null };
      session.user.id = u.id;
      (session.user as { role?: string }).role = u.role ?? "PLAYER";
      (session.user as { nickname?: string | null }).nickname = u.nickname ?? session.user.name ?? null;
      return session;
    },
  },
});

export type AppSessionUser = { id: string; role: "PLAYER" | "ADMIN"; nickname: string | null; name?: string | null; email?: string | null; image?: string | null };

export async function currentUser(): Promise<AppSessionUser | null> {
  if (!authEnabled) return null;
  const s = await auth();
  return (s?.user as AppSessionUser | undefined) ?? null;
}

export async function requireAdmin(): Promise<AppSessionUser> {
  const u = await currentUser();
  if (!u || u.role !== "ADMIN") throw new Response("Forbidden", { status: 403 });
  return u;
}
