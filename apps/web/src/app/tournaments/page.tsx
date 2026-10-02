import Tournaments from "@/components/Tournaments";
import { currentUser } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function Page() {
  const user = await currentUser().catch(() => null);
  return <Tournaments signedIn={!!user} />;
}
