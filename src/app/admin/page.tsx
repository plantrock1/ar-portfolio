import { isAdmin } from "@/lib/auth";
import { AdminLogin } from "./admin-login";
import { AdminDashboard } from "./admin-dashboard";
import { db, schema } from "@/lib/db";
import { desc } from "drizzle-orm";
import { SiteHeader } from "@/components/site-header";
import { getSiteSettings, getAggregate, getFeaturedItems } from "@/lib/queries";
import { getSpotifySession } from "@/lib/spotify/session";

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

  const [artists, settings, aggregate, session, press] = await Promise.all([
    db.select().from(schema.artists).orderBy(desc(schema.artists.addedAt)),
    getSiteSettings(),
    getAggregate(),
    getSpotifySession(),
    getFeaturedItems("press"),
  ]);

  return (
    <>
      <SiteHeader />
      <AdminDashboard
        initialArtists={artists}
        initialDisplayName={settings.displayName}
        initialRoleTitle={settings.roleTitle}
        initialBio={settings.bio}
        initialBioPhotoUrl={settings.bioPhotoUrl}
        initialSocials={settings.socials}
        initialShowListenerChart={settings.showListenerChart}
        initialSectionOrder={settings.sectionOrder}
        initialRosterDesignations={settings.rosterDesignations}
        initialPress={press.map((p) => ({
          ...p,
          addedAt: new Date(p.addedAt).toISOString(),
        }))}
        lastRefreshedAt={aggregate.asOf ? new Date(aggregate.asOf).toISOString() : null}
        session={{
          hasCookie: !!session.spDc,
          status: session.status,
          updatedAt: session.updatedAt
            ? new Date(session.updatedAt).toISOString()
            : null,
          preview: session.spDc
            ? `${session.spDc.slice(0, 4)}…${session.spDc.slice(-4)}`
            : null,
        }}
      />
    </>
  );
}
