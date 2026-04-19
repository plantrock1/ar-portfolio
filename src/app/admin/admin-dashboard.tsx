"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { Artist, ArtistSocials } from "@/lib/db/schema";

type FeaturedItem = {
  id: string;
  kind: string;
  title: string;
  url: string;
  imageUrl: string | null;
  source: string | null;
  displayOrder: number;
  addedAt: string;
};

type RefreshRun = {
  kind: "shallow" | "deep";
  status: "idle" | "running" | "done" | "failed";
  phase: string | null;
  message: string | null;
  artistIndex: number;
  artistTotal: number;
  albumsScraped: number;
  albumsTotal: number;
  tracksUpserted: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
};

export function AdminDashboard({
  initialArtists,
  initialBio,
  initialShowListenerChart,
  initialPress,
  lastRefreshedAt,
  session,
}: {
  initialArtists: Artist[];
  initialBio: string;
  initialShowListenerChart: boolean;
  initialPress: FeaturedItem[];
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
  const [showChart, setShowChart] = useState(initialShowListenerChart);
  const [press, setPress] = useState(initialPress);
  const [spDc, setSpDc] = useState("");
  const [sessionState, setSessionState] = useState(session);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, startAdding] = useTransition();
  const [isRefreshing, startRefresh] = useTransition();
  const [isDeepRefreshing, startDeepRefresh] = useTransition();
  const [isSavingBio, startSavingBio] = useTransition();
  const [isSavingSession, startSavingSession] = useTransition();
  const [editingArtistId, setEditingArtistId] = useState<string | null>(null);
  const [run, setRun] = useState<RefreshRun | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function startPolling() {
    stopPolling();
    pollTimer.current = setInterval(async () => {
      try {
        const res = await fetch("/api/admin/refresh-status", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        setRun(data.run ?? null);
        if (data.run && data.run.status !== "running") {
          stopPolling();
          router.refresh();
        }
      } catch {
        // network hiccup; keep polling
      }
    }, 1500);
  }
  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }
  useEffect(() => {
    // On mount, check if a run is already in flight (e.g., page reload during refresh)
    (async () => {
      const res = await fetch("/api/admin/refresh-status", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setRun(data.run ?? null);
      if (data.run?.status === "running") startPolling();
    })();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function optimisticRun(kind: "shallow" | "deep"): RefreshRun {
    const now = new Date().toISOString();
    return {
      kind,
      status: "running",
      phase: "starting",
      message: kind === "deep" ? "Starting deep refresh…" : "Starting refresh…",
      artistIndex: 0,
      artistTotal: 0,
      albumsScraped: 0,
      albumsTotal: 0,
      tracksUpserted: 0,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      error: null,
    };
  }

  async function refreshNow() {
    setError(null);
    setMessage(null);
    setRun(optimisticRun("shallow"));
    startPolling();
    const res = await fetch("/api/cron/refresh");
    const data = await parseResponse(res);
    stopPolling();
    // Final poll to pick up completion state
    const final = await fetch("/api/admin/refresh-status", {
      cache: "no-store",
    });
    if (final.ok) setRun((await final.json()).run ?? null);
    if (!res.ok) {
      setError(data.error ?? "Refresh failed");
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
    setMessage(null);
    setRun(optimisticRun("deep"));
    startPolling();
    const res = await fetch("/api/cron/deep-refresh");
    const data = await parseResponse(res);
    stopPolling();
    const final = await fetch("/api/admin/refresh-status", {
      cache: "no-store",
    });
    if (final.ok) setRun((await final.json()).run ?? null);
    if (!res.ok) {
      setError(data.error ?? "Deep refresh failed");
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

  async function toggleChart(next: boolean) {
    setShowChart(next);
    await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showListenerChart: next }),
    });
    router.refresh();
  }

  async function saveArtist(
    id: string,
    patch: { bio?: string; socials?: ArtistSocials; role?: string },
  ) {
    const res = await fetch("/api/admin/artists", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    if (!res.ok) {
      const data = await parseResponse(res);
      setError(data.error ?? "Failed to save artist");
      return false;
    }
    setArtists((xs) =>
      xs.map((a) =>
        a.id === id
          ? {
              ...a,
              bio: patch.bio ?? a.bio,
              socials: patch.socials ?? a.socials,
              role: patch.role ?? a.role,
            }
          : a,
      ),
    );
    return true;
  }

  async function addFeatured(body: {
    title: string;
    url: string;
    imageUrl?: string;
    source?: string;
  }) {
    const res = await fetch("/api/admin/featured", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await parseResponse(res);
    if (!res.ok) {
      setError(data.error ?? "Failed to add");
      return false;
    }
    setPress((xs) => [...xs, data.item]);
    router.refresh();
    return true;
  }

  async function removeFeatured(id: string) {
    if (!confirm("Remove this item?")) return;
    await fetch("/api/admin/featured", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setPress((xs) => xs.filter((x) => x.id !== id));
    router.refresh();
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
        <div className="mt-3 flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showChart}
              onChange={(e) => toggleChart(e.target.checked)}
              className="accent-[#1db954]"
            />
            Show monthly listeners growth chart on artist pages
          </label>
          <div className="flex items-center gap-3">
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
        </div>
      </section>

      <FeaturedSection
        items={press}
        onAdd={addFeatured}
        onRemove={removeFeatured}
      />

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
        {run && run.status === "running" ? (
          <ProgressBar run={run} />
        ) : null}
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          <div className="text-white/50 min-w-0 flex-1">
            {message ? <span className="text-green-400">{message}</span> : null}
            {error ? <span className="text-red-400">{error}</span> : null}
            {!message && !error && run && run.status !== "running" ? (
              <LastRunLabel run={run} />
            ) : null}
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
              <ArtistRow
                key={a.id}
                artist={a}
                expanded={editingArtistId === a.id}
                onToggle={() =>
                  setEditingArtistId(editingArtistId === a.id ? null : a.id)
                }
                onSave={(patch) => saveArtist(a.id, patch)}
                onDelete={() => deleteArtist(a.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function ArtistRow({
  artist,
  expanded,
  onToggle,
  onSave,
  onDelete,
}: {
  artist: Artist;
  expanded: boolean;
  onToggle: () => void;
  onSave: (patch: { bio?: string; socials?: ArtistSocials; role?: string }) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [bio, setBio] = useState(artist.bio ?? "");
  const [role, setRole] = useState(artist.role ?? "");
  const [socials, setSocials] = useState<ArtistSocials>(
    (artist.socials ?? {}) as ArtistSocials,
  );
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    const ok = await onSave({ bio, role, socials });
    setSaving(false);
    if (ok) {
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 1500);
    }
  }

  return (
    <li className="flex flex-col">
      <div
        className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02] cursor-pointer"
        onClick={onToggle}
      >
        {artist.imageUrl ? (
          <Image
            src={artist.imageUrl}
            alt={artist.name}
            width={40}
            height={40}
            className="rounded-full"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-neutral-800" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-white truncate">{artist.name}</div>
          <div className="text-xs text-white/40 truncate">
            {artist.role ?? "—"} · /{artist.slug}
          </div>
        </div>
        <a
          href={`/artist/${artist.slug}`}
          target="_blank"
          onClick={(e) => e.stopPropagation()}
          className="text-xs text-white/40 hover:text-white"
        >
          View
        </a>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-xs text-red-400/70 hover:text-red-400 px-2"
        >
          Remove
        </button>
        <span className="text-white/30 text-xs w-4 text-center">
          {expanded ? "▾" : "▸"}
        </span>
      </div>
      {expanded ? (
        <div className="px-4 py-4 bg-black/30 border-t border-white/5 flex flex-col gap-3">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-white/40">
              Role
            </label>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g., Signed 2023 / Producer"
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-white/40">
              Bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              placeholder="Short bio shown on the artist page"
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 resize-y"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["instagram", "Instagram URL"],
                ["tiktok", "TikTok URL"],
                ["twitter", "Twitter / X URL"],
                ["youtube", "YouTube URL"],
                ["soundcloud", "SoundCloud URL"],
                ["website", "Website"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label className="text-[10px] uppercase tracking-widest text-white/40">
                  {label}
                </label>
                <input
                  value={(socials[key] as string) ?? ""}
                  onChange={(e) =>
                    setSocials({ ...socials, [key]: e.target.value })
                  }
                  placeholder="https://…"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-3">
            {savedMsg ? (
              <span className="text-xs text-green-400">{savedMsg}</span>
            ) : null}
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB

function FeaturedSection({
  items,
  onAdd,
  onRemove,
}: {
  items: FeaturedItem[];
  onAdd: (body: {
    title: string;
    url: string;
    imageUrl?: string;
    source?: string;
  }) => Promise<boolean>;
  onRemove: (id: string) => void;
}) {
  const [t, setT] = useState("");
  const [u, setU] = useState("");
  const [img, setImg] = useState(""); // data: URL or http URL
  const [imgName, setImgName] = useState<string | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [src, setSrc] = useState("");
  const [adding, setAdding] = useState(false);

  async function onPickFile(file: File) {
    setImgError(null);
    if (!file.type.startsWith("image/")) {
      setImgError("Not an image file");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImgError("Image is over 4MB — try a smaller file");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    setImg(dataUrl);
    setImgName(file.name);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    const ok = await onAdd({
      title: t,
      url: u,
      imageUrl: img || undefined,
      source: src || undefined,
    });
    setAdding(false);
    if (ok) {
      setT("");
      setU("");
      setImg("");
      setImgName(null);
      setSrc("");
    }
  }

  return (
    <section className="rounded-xl border border-white/5 bg-white/[0.02] p-6 mb-8">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="display text-xl text-white">Featured media</h2>
        <span className="text-xs text-white/40">
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
      </div>
      <p className="text-xs text-white/50 mb-4">
        Articles, videos, interviews. YouTube links auto-fetch thumbnails.
        Hidden from the home page when empty.
      </p>

      <form onSubmit={submit} className="grid md:grid-cols-[1fr_1fr_auto] gap-2 mb-2">
        <input
          value={t}
          onChange={(e) => setT(e.target.value)}
          placeholder="Title"
          required
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
        />
        <input
          value={u}
          onChange={(e) => setU(e.target.value)}
          placeholder="Link URL (article or video)"
          required
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
        />
        <button
          type="submit"
          disabled={adding || !t || !u}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
        >
          {adding ? "Adding…" : "Add"}
        </button>
        <input
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          placeholder="Source (optional, e.g., Rolling Stone)"
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 md:col-span-3"
        />
        <div className="md:col-span-3 flex flex-wrap items-center gap-3 pt-1">
          <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-white/60 hover:text-white">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickFile(f);
              }}
            />
            <span className="rounded-lg border border-white/15 bg-white/5 px-3 py-2">
              Upload image
            </span>
          </label>
          <span className="text-xs text-white/40">or</span>
          <input
            value={img.startsWith("data:") ? "" : img}
            onChange={(e) => {
              setImg(e.target.value);
              setImgName(null);
            }}
            placeholder="Paste image URL"
            className="flex-1 min-w-[200px] rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
          />
          {img ? (
            <div className="flex items-center gap-2 text-xs text-white/60">
              <span className="text-green-400">
                ✓ {imgName ?? "image attached"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setImg("");
                  setImgName(null);
                }}
                className="text-white/40 hover:text-red-400"
              >
                clear
              </button>
            </div>
          ) : null}
          {imgError ? (
            <span className="text-xs text-red-400">{imgError}</span>
          ) : null}
        </div>
      </form>

      {items.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-white/10 p-6 text-center text-white/40 text-sm">
          Nothing here yet. Add a link and it'll appear on your home page.
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-white/5 border border-white/5 rounded-xl overflow-hidden">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-4 px-3 py-2 hover:bg-white/[0.02]"
            >
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  className="rounded object-cover w-16 h-10"
                />
              ) : (
                <div className="w-16 h-10 rounded bg-neutral-800" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-white text-sm truncate">{item.title}</div>
                <div className="text-xs text-white/40 truncate">
                  {item.source ? `${item.source} · ` : ""}
                  {item.url}
                </div>
              </div>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-white/40 hover:text-white"
              >
                Open
              </a>
              <button
                onClick={() => onRemove(item.id)}
                className="text-xs text-red-400/70 hover:text-red-400 px-2"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProgressBar({ run }: { run: RefreshRun }) {
  // Rough total = artistTotal (for shallow) OR albumsTotal (for deep).
  const denom = run.kind === "deep" ? Math.max(run.albumsTotal, 1) : Math.max(run.artistTotal, 1);
  const done = run.kind === "deep" ? run.albumsScraped : run.artistIndex;
  const pct = Math.min(100, Math.round((done / denom) * 100));
  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-sm text-white">
          <span className="text-white/50">
            {run.kind === "deep" ? "Deep refresh" : "Refresh"} ·{" "}
          </span>
          {run.message ?? run.phase ?? "Working…"}
        </div>
        <div className="text-xs text-white/50 tabular-nums">
          {run.kind === "deep"
            ? `${run.albumsScraped}/${run.albumsTotal} albums · ${run.tracksUpserted} tracks`
            : `${run.artistIndex}/${run.artistTotal} artists · ${run.tracksUpserted} tracks`}
        </div>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full bg-[#1db954] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function LastRunLabel({ run }: { run: RefreshRun }) {
  if (!run.completedAt) return null;
  const ended = new Date(run.completedAt);
  const secs = run.completedAt
    ? Math.round(
        (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) /
          1000,
      )
    : 0;
  const when = ended.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  if (run.status === "failed") {
    return (
      <span className="text-red-400">
        Last {run.kind} run failed at {when}
        {run.error ? ` — ${run.error}` : ""}
      </span>
    );
  }
  return (
    <span className="text-white/50">
      Last {run.kind} run finished {when} · {secs}s
    </span>
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
