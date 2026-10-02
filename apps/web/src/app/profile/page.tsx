import Profile from "@/components/Profile";
import { currentUser, authEnabled } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function Page() {
  const user = await currentUser().catch(() => null);
  return <Profile signedIn={!!user} authEnabled={authEnabled} />;
}
