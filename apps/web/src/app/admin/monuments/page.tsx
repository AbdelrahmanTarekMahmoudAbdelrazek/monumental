import Link from "next/link";
import AdminMonuments from "@/components/AdminMonuments";
import { currentUser } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function Page() {
  const user = await currentUser().catch(() => null);
  if (!user || user.role !== "ADMIN") {
    return (
      <div className="mx-auto max-w-md px-3 py-10 text-center">
        <h1 className="text-2xl font-black">Admin only</h1>
        <p className="mt-2 text-sm text-ink-500">Sign in with an account listed in <code>ADMIN_EMAILS</code> to manage monuments.</p>
        <Link href="/auth/signin" className="btn-primary mt-4">Sign in</Link>
      </div>
    );
  }
  return <AdminMonuments />;
}
