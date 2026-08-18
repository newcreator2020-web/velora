import { requireAuthenticatedUser } from "@/lib/server/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireAuthenticatedUser();
  return <>{children}</>;
}
