"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { Artist } from "@/lib/db/schema";

export function AdminDashboard({
  initialArtists,
  initialBio,
  lastRefreshedAt,
  session,
}: {
  initialArtists: Artist[];
  initialBio: string;
  lastRefreshedAt: string | null;
  session: {
    hasCookie: boolean;
    status: "ok" | "expired" | "unknown";
    updatedAt: string | null;
    preview: string | null;
  };
}) {
  const router = useRouter();
  const [artists, setArtists] = useState(initialArtists);
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [role, setRole] = useState("");
  const [bio, setBio] = useState(initialBio);
  const [savedBio, setSavedBio] = useState(initialBio);
  const [spDc, setSpDc] = useState("");
  const [sessionState, setSessionState] = useState(session);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, startAdding] = useTransition();
  const [isRefreshing, startRefresh] = useTransition();
  const [isDeepRefreshing, startDeepRefresh] = useTransition();
  const [isSavingBio, startSavingBio] = useTransition();
  const [isSavingSession, startSavingSession] = useTransition();

  async function parseResponse(res: Response) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: text.slice(0, 200) || `HTTP ${res.status}` };
    }
  }

  async function addArtist(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const res = await fetch("/api/admin/artists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spotifyUrl, role }),
    });
    const data = await parseResponse(res);
    if (!res.ok) {
      setError(data.error ?? "Failed to add");
      return;
    }
    if (data.duplicate) {
      setMessage(`${data.artist.name} is already on the roster.`);
    } else {
      setMessage(`Added ${data.artist.name}.`);
      setArtists((xs) => [data.artist, ...xs]);
    }
    setSpotifyUrl("");
    setRole("");
    startAdding(() => router.refresh());
  }

  async function deleteArtist(id: string) {
    if (!confirm("Remove this artist from the roster?")) return;
    const res = await fetch("/api/admin/artists", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      setError("Failed to delete");
      return;
    }
    setArtists((xs) => xs.filter((x) => x.id !== id));
    router.refresh();
  }

  async function refreshNow() {
    setError(null);
    setMessage("Refreshing… (headless browser, ~20s)");
    const res = await fetch("/api/cron/refresh");
    const data = await parseResponse(res);
    if (!res.ok) {
      setError(data.error ?? "Refresh failed");
      setMessage(null);
      return;
    }
    setMessage(
      `Refreshed ${data.artistsRefreshed} artists · ${data.scrapeHits}/${
        data.scrapeHits + data.scrapeMisses
      } monthly listener scrapes succeeded · ${Math.round(data.durationMs / 1000)}s`,
    );
    startRefresh(() => router.refresh());
  }

  async function deepRefresh() {
    setError(null);
    setMessage("Deep refresh running… scraping every album, this may take several minutes.");
    const res = await fetch("/api/cron/deep-refresh");
    const data = await parseResponse(res);
    if (!res.ok) {
      setError(data.error ?? "Deep refresh failed");
      setMessage(null);
      return;
    }
    setMessage(
      `Deep refresh complete · ${data.artistsRefreshed} artists · ${data.albumsScraped} albums · ${data.tracksRefreshed} tracks · ${Math.round(data.durationMs / 1000)}s`,
    );
    startDeepRefresh(() => router.refresh());
  }

  async function saveSession() {
    setError(null);
    setMessage(null);
    if (!spDc.trim()) return;
    const res = await fetch("/api/admin/spotify-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spDc: spDc.trim() }),
    });
    const data = await parseResponse(res);
    if (!res.ok) {
      setError(data.error ?? "Failed to save session");
      return;
    }
    setMessage("Session cookie saved.");
    setSpDc("");
    const short = `${spDc.trim().slice(0, 4)}…${spDc.trim().slice(-4)}`;
    setSessionState({
      hasCookie: true,
      status: "unknown",
      updatedAt: new Date().toISOString(),
      preview: short,
    });
    startSavingSession(() => router.refresh());
  }

  async function clearSession() {
    if (!confirm("Remove stored Spotify session cookie?")) return;
    await fetch("/api/admin/spotify-session", { method: "DELETE" });
    setSessionState({
      hasCookie: false,
      status: "unknown",
      updatedAt: null,
      preview: null,
    });
    router.refresh();
  }

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    router.refresh();
  }

  async function saveBio() {
    setError(null);
    setMessage(null);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bio }),
    });
    if (!res.ok) {
      const data = await parseResponse(res);
      setError(data.error ?? "Failed to save bio");
      return;
    }
    setSavedBio(bio);
    setMessage("Bio saved.");
    startSavingBio(() => router.refresh());
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 pt-12 pb-20">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="display text-4xl text-white">Admin</h1>
          <p className="text-white/50 text-sm mt-1">
            Manage the roster and trigger a refresh.
          </p>
          <p className="text-white/40 text-xs mt-2">
            Last refresh:{" "}
            {lastRefreshedAt
              ? new Date(lastRefreshedAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "never"}
          </p>
        </div>
        <button
          onClick={logout}
          className="text-xs text-white/40 hover:text-white"
        >
          Sign out
        </button>
      </div>

      <section className="rounded-xl border border-white/5 bg-white/[0.02] p-6 mb-8">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="display text-xl text-white">Bio</h2>
          <span className="text-xs text-white/40">
            Appears under your name on the home page
          </span>
        </div>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={4}
          placeholder="A&R working with artists across…"
          className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 resize-y"
        />
        <div className="mt-3 flex items-center justify-end gap-3">
          <span className="text-xs text-white/40">
            {bio.length}/2000 chars
          </span>
          <button
            onClick={saveBio}
            disabled={isSavingBio || bio === savedBio}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
          >
            {isSavingBio ? "Saving…" : bio === savedBio ? "Saved" : "Save bio"}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-white/5 bg-white/[0.02] p-6 mb-8">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="display text-xl text-white">Spotify session</h2>
          <SessionBadge status={sessionState.hasCookie ? sessionState.status : "absent"} />
        </div>
        <p className="text-xs text-white/50 leading-relaxed mb-4">
          Pasting your <code className="text-white/80">sp_dc</code> cookie lets the scraper
          see per-track stream counts on album pages. One-time setup; cookie lasts
          ~12 months.
        </p>
        <details className="text-xs text-white/50 mb-4 rounded border border-white/10 bg-black/20">
          <summary className="cursor-pointer px-3 py-2 hover:text-white/80">
            How to get your sp_dc cookie →
          </summary>
          <ol className="list-decimal list-inside px-4 pb-3 pt-1 space-y-1 text-white/60">
            <li>Log into <a href="https://open.spotify.com" target="_blank" rel="noreferrer" className="underline text-white/80">open.spotify.com</a> in Chrome</li>
            <li>Open DevTools (⌥⌘I) → Application tab → Cookies → <code>https://open.spotify.com</code></li>
            <li>Find the row named <code>sp_dc</code>, copy the Value column</li>
            <li>Paste it below and hit Save</li>
          </ol>
        </details>
        {sessionState.hasCookie ? (
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3 mb-3">
            <div className="flex flex-col">
              <span className="text-sm text-white">
                Cookie stored: <code className="text-white/60">{sessionState.preview}</code>
              </span>
              <span className="text-xs text-white/40">
                {sessionState.updatedAt
                  ? `Saved ${new Date(sessionState.updatedAt).toLocaleString()}`
                  : ""}
              </span>
            </div>
            <button
              onClick={clearSession}
              className="text-xs text-red-400/70 hover:text-red-400"
            >
              Remove
            </button>
          </div>
        ) : null}
        <div className="grid md:grid-cols-[1fr_auto] gap-3">
          <input
            type="password"
            value={spDc}
            onChange={(e) => setSpDc(e.target.value)}
            placeholder={sessionState.hasCookie ? "Paste a new cookie to replace…" : "Paste sp_dc cookie value…"}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 font-mono text-sm"
          />
          <button
            onClick={saveSession}
            disabled={isSavingSession || !spDc.trim()}
            className="rounded-lg bg-white px-4 py-3 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
          >
            {isSavingSession ? "Saving…" : "Save cookie"}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-white/5 bg-white/[0.02] p-6 mb-8">
        <h2 className="display text-xl text-white mb-4">Add artist</h2>
        <form onSubmit={addArtist} className="grid md:grid-cols-[1fr_200px_auto] gap-3">
          <input
            value={spotifyUrl}
            onChange={(e) => setSpotifyUrl(e.target.value)}
            placeholder="https://open.spotify.com/artist/…"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
            required
          />
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Role (optional)"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
          />
          <button
            type="submit"
            disabled={isAdding || !spotifyUrl}
            className="rounded-lg bg-white px-4 py-3 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
          >
            {isAdding ? "Adding…" : "Add"}
          </button>
        </form>
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          <div className="text-white/50 min-w-0 flex-1">
            {message ? <span className="text-green-400">{message}</span> : null}
            {error ? <span className="text-red-400">{error}</span> : null}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={refreshNow}
              disabled={isRefreshing || isDeepRefreshing}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-50"
              title="Re-scrapes artist pages only — monthly listeners + top tracks. ~20s."
            >
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button
              onClick={deepRefresh}
              disabled={
                isRefreshing ||
                isDeepRefreshing ||
                !sessionState.hasCookie
              }
              className="rounded-lg bg-[#1db954] px-4 py-2 text-sm font-medium text-black hover:bg-[#1ed760] disabled:opacity-40"
              title={
                sessionState.hasCookie
                  ? "Visits every album page for every artist — full stream counts. Several minutes."
                  : "Requires sp_dc session cookie (see above)"
              }
            >
              {isDeepRefreshing ? "Deep refresh…" : "Deep refresh"}
            </button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="display text-xl text-white mb-4">
          Roster · {artists.length}
        </h2>
        {artists.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-10 text-center text-white/50">
            Empty. Add your first artist above.
          </div>
        ) : (
          <ul className="divide-y divide-white/5 border border-white/5 rounded-xl overflow-hidden">
            {artists.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02]"
              >
                {a.imageUrl ? (
                  <Image
                    src={a.imageUrl}
                    alt={a.name}
                    width={40}
                    height={40}
                    className="rounded-full"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-neutral-800" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-white truncate">{a.name}</div>
                  <div className="text-xs text-white/40 truncate">
                    {a.role ?? "—"} · /{a.slug}
                  </div>
                </div>
                <a
                  href={`/artist/${a.slug}`}
                  target="_blank"
                  className="text-xs text-white/40 hover:text-white"
                >
                  View
                </a>
                <button
                  onClick={() => deleteArtist(a.id)}
                  className="text-xs text-red-400/70 hover:text-red-400 px-2"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function SessionBadge({
  status,
}: {
  status: "ok" | "expired" | "unknown" | "absent";
}) {
  const map = {
    ok: { label: "Active", className: "text-green-400 bg-green-500/10 border-green-500/20" },
    unknown: { label: "Not verified", className: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20" },
    expired: { label: "Expired", className: "text-red-400 bg-red-500/10 border-red-500/20" },
    absent: { label: "Not set", className: "text-white/40 bg-white/5 border-white/10" },
  } as const;
  const { label, className } = map[status];
  return (
    <span
      className={`text-[10px] uppercase tracking-widest rounded-full border px-2 py-1 ${className}`}
    >
      {label}
    </span>
  );
}
