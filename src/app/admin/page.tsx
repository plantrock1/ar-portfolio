import { isAdmin } from "@/lib/auth";
import { AdminLogin } from "./admin-login";
import { AdminDashboard } from "./admin-dashboard";
import { db, schema } from "@/lib/db";
import { desc } from "drizzle-orm";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const authed = await isAdmin();
  if (!authed) {
    return (
      <>
        <SiteHeader />
        <AdminLogin />
      </>
    );
  }

  const artists = await db
    .select()
    .from(schema.artists)
    .orderBy(desc(schema.artists.addedAt));

  return (
    <>
      <SiteHeader />
      <AdminDashboard initialArtists={artists} />
    </>
  );
}
