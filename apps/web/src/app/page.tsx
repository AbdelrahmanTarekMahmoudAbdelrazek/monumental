import Home from "@/components/Home";
import { currentUser } from "@/lib/auth";

export default async function Page() {
  const user = await currentUser().catch(() => null);
  return <Home signedInNickname={user?.nickname ?? user?.name ?? null} />;
}
