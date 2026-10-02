import { signIn, authEnabled } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const hasGoogle = !!process.env.AUTH_GOOGLE_ID;
  const hasEmail = !!process.env.EMAIL_SERVER;
  return (
    <div className="mx-auto max-w-sm px-3 py-10">
      <div className="card">
        <h1 className="text-2xl font-black">Sign in</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-300">Optional — save stats, rank and history across devices. Guests can play instantly.</p>
        {!authEnabled && <p className="mt-4 rounded-xl bg-amber-400/20 p-3 text-sm">Sign-in isn&apos;t configured on this deployment (set AUTH_GOOGLE_* or EMAIL_SERVER). You can still play as a guest.</p>}
        {error && <p className="mt-3 text-sm font-semibold text-rose-500">Sign-in failed: {error}</p>}
        {hasGoogle && (
          <form className="mt-4" action={async () => { "use server"; await signIn("google", { redirectTo: "/profile" }); }}>
            <button className="btn-ghost w-full">Continue with Google</button>
          </form>
        )}
        {hasEmail && (
          <form className="mt-3" action={async (fd: FormData) => { "use server"; await signIn("nodemailer", { email: String(fd.get("email")), redirectTo: "/profile" }); }}>
            <label className="label">Email magic link</label>
            <input className="input" type="email" name="email" required placeholder="you@example.com" />
            <button className="btn-primary mt-2 w-full">Send link</button>
          </form>
        )}
        <form className="mt-4" action={async () => { "use server"; redirect("/"); }}><button className="w-full text-center text-sm text-ink-500 hover:underline">Continue as guest</button></form>
      </div>
    </div>
  );
}
