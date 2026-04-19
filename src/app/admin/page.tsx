import { isAdmin } from "@/lib/auth";
import { AdminLogin } from "./admin-login";
import { AdminDashboard } from "./admin-dashboard";
import { db, schema } from "@/lib/db";
import { desc } from "drizzle-orm";
import { SiteHeader } from "@/components/site-header";
import { getSiteSettings, getAggregate } from "@/lib/queries";

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

  const [artists, settings, aggregate] = await Promise.all([
    db.select().from(schema.artists).orderBy(desc(schema.artists.addedAt)),
    getSiteSettings(),
    getAggregate(),
  ]);

  return (
    <>
      <SiteHeader />
      <AdminDashboard
        initialArtists={artists}
        initialBio={settings.bio}
        lastRefreshedAt={aggregate.asOf ? aggregate.asOf.toISOString() : null}
      />
    </>
  );
}
