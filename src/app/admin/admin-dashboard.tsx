"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { Artist, ArtistSocials, SectionId } from "@/lib/db/schema";

const SECTION_LABELS: Record<SectionId, string> = {
  roster: "Roster",
  top_tracks: "Top tracks",
  featured_media: "Featured media",
};

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
  initialDisplayName,
  initialBio,
  initialBioPhotoUrl,
  initialSocials,
  initialShowListenerChart,
  initialSectionOrder,
  initialRosterDesignations,
  initialPress,
  lastRefreshedAt,
  session,
}: {
  initialArtists: Artist[];
  initialDisplayName: string;
  initialBio: string;
  initialBioPhotoUrl: string | null;
  initialSocials: ArtistSocials;
  initialShowListenerChart: boolean;
  initialSectionOrder: SectionId[];
  initialRosterDesignations: string[];
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
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [savedDisplayName, setSavedDisplayName] = useState(initialDisplayName);
  const [bio, setBio] = useState(initialBio);
  const [savedBio, setSavedBio] = useState(initialBio);
  const [bioPhotoUrl, setBioPhotoUrl] = useState<string | null>(
    initialBioPhotoUrl,
  );
  const [savedBioPhotoUrl, setSavedBioPhotoUrl] = useState<string | null>(
    initialBioPhotoUrl,
  );
  const [bioPhotoError, setBioPhotoError] = useState<string | null>(null);
  const [socials, setSocials] = useState<ArtistSocials>(initialSocials ?? {});
  const [savedSocials, setSavedSocials] = useState<ArtistSocials>(
    initialSocials ?? {},
  );
  const [showChart, setShowChart] = useState(initialShowListenerChart);
  const [press, setPress] = useState(initialPress);
  const [spDc, setSpDc] = useState("");
  const [sessionState, setSessionState] = useState(session);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(initialSectionOrder);
  const [designations, setDesignations] = useState<string[]>(
    initialRosterDesignations ?? [],
  );
  const [newDesignation, setNewDesignation] = useState("");
  const [isAdding, startAdding] = useTransition();
  const [isRefreshing, startRefresh] = useTransition();
  const [isDeepRefreshing, startDeepRefresh] = useTransition();
  const [isSavingBio, startSavingBio] = useTransition();
  const [isSavingSession, startSavingSession] = useTransition();
  const [editingArtistId, setEditingArtistId] = useState<string | null>(null);
  // Change password state
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);
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

    // Chunked client loop: each call processes 5 artists at a time, so we
    // stay comfortably under Vercel's 60-second function timeout no matter
    // how large the roster is. Progress bar updates via the status poller
    // while each chunk runs.
    const CHUNK = 5;
    let offset = 0;
    let totalArtists = 0;
    let totalHits = 0;
    let totalMisses = 0;
    let totalTracks = 0;
    const runStart = Date.now();
    try {
      while (true) {
        const res = await fetch(
          `/api/cron/refresh?offset=${offset}&limit=${CHUNK}`,
        );
        const data = await parseResponse(res);
        if (!res.ok) {
          setError(data.error ?? "Refresh failed");
          stopPolling();
          return;
        }
        totalArtists += data.artistsRefreshed ?? 0;
        totalHits += data.scrapeHits ?? 0;
        totalMisses += data.scrapeMisses ?? 0;
        totalTracks += data.tracksRefreshed ?? 0;
        if (data.nextOffset === null || data.nextOffset === undefined) break;
        offset = data.nextOffset;
      }
    } finally {
      stopPolling();
    }

    // Final status poll to pick up the completion state.
    const final = await fetch("/api/admin/refresh-status", {
      cache: "no-store",
    });
    if (final.ok) setRun((await final.json()).run ?? null);

    const elapsedSec = Math.round((Date.now() - runStart) / 1000);
    const missText =
      totalMisses > 0
        ? ` · ${totalMisses} artist${totalMisses === 1 ? "" : "s"} kept their previous value (page load timeout)`
        : "";
    setMessage(
      `Refreshed ${totalArtists} artists · ${totalHits}/${
        totalHits + totalMisses
      } succeeded · ${elapsedSec}s${missText}`,
    );
    startRefresh(() => router.refresh());
    void totalTracks;
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

  async function persistDesignations(next: string[]) {
    setDesignations(next);
    await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rosterDesignations: next }),
    });
    router.refresh();
  }
  async function addDesignation() {
    const name = newDesignation.trim();
    if (!name) return;
    if (
      designations.some((d) => d.toLowerCase() === name.toLowerCase())
    )
      return;
    setNewDesignation("");
    await persistDesignations([...designations, name]);
  }
  async function removeDesignation(name: string) {
    await persistDesignations(designations.filter((d) => d !== name));
  }
  async function moveDesignation(idx: number, dir: -1 | 1) {
    const next = [...designations];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    await persistDesignations(next);
  }

  async function moveSection(index: number, dir: -1 | 1) {
    const next = [...sectionOrder];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSectionOrder(next);
    await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionOrder: next }),
    });
    router.refresh();
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwErr(null);
    setPwMsg(null);
    if (pwNew !== pwConfirm) {
      setPwErr("New passwords don't match");
      return;
    }
    if (pwNew.length < 8) {
      setPwErr("New password must be at least 8 characters");
      return;
    }
    setPwSaving(true);
    const res = await fetch("/api/admin/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: pwCurrent,
        newPassword: pwNew,
      }),
    });
    const data = await parseResponse(res);
    setPwSaving(false);
    if (!res.ok) {
      setPwErr(data.error ?? "Failed to change password");
      return;
    }
    setPwMsg("Password updated. It'll be required next time you sign in.");
    setPwCurrent("");
    setPwNew("");
    setPwConfirm("");
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
      body: JSON.stringify({
        displayName,
        bio,
        socials,
        bioPhotoUrl: bioPhotoUrl ?? "",
      }),
    });
    if (!res.ok) {
      const data = await parseResponse(res);
      setError(data.error ?? "Failed to save bio");
      return;
    }
    setSavedDisplayName(displayName);
    setSavedBio(bio);
    setSavedSocials(socials);
    setSavedBioPhotoUrl(bioPhotoUrl);
    setMessage("Saved.");
    startSavingBio(() => router.refresh());
  }

  async function pickBioPhoto(file: File) {
    setBioPhotoError(null);
    if (!file.type.startsWith("image/")) {
      setBioPhotoError("Not an image");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setBioPhotoError("Image over 4MB — try a smaller file");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    setBioPhotoUrl(dataUrl);
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
    patch: {
      bio?: string;
      socials?: ArtistSocials;
      role?: string;
      designation?: string | null;
    },
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
              designation:
                patch.designation === undefined
                  ? a.designation
                  : patch.designation,
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
          <h2 className="display text-xl text-white">Your profile</h2>
          <span className="text-xs text-white/40">
            Shown on the home page and in the browser tab
          </span>
        </div>
        <div className="mb-4">
          <label className="text-[10px] uppercase tracking-widest text-white/40">
            Display name
          </label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g., John Smith"
            className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
          />
        </div>
        <div className="flex gap-4 items-start">
          <div className="flex flex-col items-center gap-2 shrink-0">
            <div className="w-24 h-24 rounded-full overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center">
              {bioPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={bioPhotoUrl}
                  alt="Bio"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-xs text-white/30">No photo</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label className="cursor-pointer text-white/60 hover:text-white">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) pickBioPhoto(f);
                  }}
                />
                <span className="underline">
                  {bioPhotoUrl ? "Replace" : "Upload"}
                </span>
              </label>
              {bioPhotoUrl ? (
                <>
                  <span className="text-white/20">·</span>
                  <button
                    type="button"
                    onClick={() => setBioPhotoUrl(null)}
                    className="text-red-400/70 hover:text-red-400"
                  >
                    Remove
                  </button>
                </>
              ) : null}
            </div>
            {bioPhotoError ? (
              <span className="text-xs text-red-400">{bioPhotoError}</span>
            ) : null}
          </div>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={5}
            placeholder="A&R working with artists across…"
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 resize-y"
          />
        </div>
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
            Your social links (appear as icons next to your bio)
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["instagram", "Instagram URL"],
                ["tiktok", "TikTok URL"],
                ["twitter", "Twitter / X URL"],
                ["email", "Email address"],
                ["soundcloud", "SoundCloud URL"],
                ["website", "Website"],
              ] as const
            ).map(([key, label]) => (
              <input
                key={key}
                value={(socials[key] as string) ?? ""}
                onChange={(e) => setSocials({ ...socials, [key]: e.target.value })}
                placeholder={label}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
              />
            ))}
          </div>
        </div>
        {(() => {
          const dirty =
            displayName !== savedDisplayName ||
            bio !== savedBio ||
            bioPhotoUrl !== savedBioPhotoUrl ||
            JSON.stringify(socials) !== JSON.stringify(savedSocials);
          return (
        <>
        <div className="mt-5 border-t border-white/5 pt-5">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[10px] uppercase tracking-widest text-white/40">
              Roster designations (optional)
            </div>
            <span className="text-[10px] text-white/30">
              {designations.length === 0
                ? "Off — single roster"
                : `${designations.length} group${designations.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <p className="text-xs text-white/40 mb-3">
            Split the roster into labeled groups (e.g., Management, Distribution).
            Assign each artist a designation in their row below. Empty = single
            unified Roster.
          </p>
          {designations.length > 0 ? (
            <ul className="flex flex-col gap-1 mb-2">
              {designations.map((d, i) => (
                <li
                  key={d}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
                >
                  <span className="text-white">{d}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveDesignation(i, -1)}
                      disabled={i === 0}
                      className="w-6 h-6 rounded border border-white/10 text-white/60 hover:text-white hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveDesignation(i, 1)}
                      disabled={i === designations.length - 1}
                      className="w-6 h-6 rounded border border-white/10 text-white/60 hover:text-white hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeDesignation(d)}
                      className="w-6 h-6 rounded border border-white/10 text-red-400/70 hover:text-red-400 hover:border-red-400/40"
                      aria-label="Remove"
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <input
              value={newDesignation}
              onChange={(e) => setNewDesignation(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDesignation();
                }
              }}
              placeholder="Add a designation, e.g., Management"
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
            />
            <button
              type="button"
              onClick={addDesignation}
              disabled={!newDesignation.trim()}
              className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>

        <div className="mt-5 border-t border-white/5 pt-5">
          <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
            Homepage section order
          </div>
          <ul className="flex flex-col gap-1 mb-2">
            {sectionOrder.map((s, i) => (
              <li
                key={s}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
              >
                <span className="text-white">
                  {SECTION_LABELS[s]}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveSection(i, -1)}
                    disabled={i === 0}
                    className="w-6 h-6 rounded border border-white/10 text-white/60 hover:text-white hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(i, 1)}
                    disabled={i === sectionOrder.length - 1}
                    className="w-6 h-6 rounded border border-white/10 text-white/60 hover:text-white hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
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
              disabled={isSavingBio || !dirty}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
            >
              {isSavingBio ? "Saving…" : !dirty ? "Saved" : "Save"}
            </button>
          </div>
        </div>
        </>
          );
        })()}
      </section>

      <section className="rounded-xl border border-white/5 bg-white/[0.02] p-6 mb-8">
        <h2 className="display text-xl text-white mb-4">Add artist</h2>
        <BulkAddArtists
          onAddBatch={async (urls) => {
            let added = 0;
            let duplicate = 0;
            let failed = 0;
            const failures: string[] = [];
            for (const url of urls) {
              const res = await fetch("/api/admin/artists", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ spotifyUrl: url }),
              });
              const data = await parseResponse(res);
              if (!res.ok) {
                failed += 1;
                failures.push(`${url}: ${data.error ?? res.status}`);
                continue;
              }
              if (data.duplicate) {
                duplicate += 1;
              } else {
                added += 1;
                setArtists((xs) => [data.artist, ...xs]);
              }
            }
            router.refresh();
            return { added, duplicate, failed, failures };
          }}
        />
        <form onSubmit={addArtist} className="grid md:grid-cols-[1fr_200px_auto] gap-3 mt-5">
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
              title="Fast update (~30s): refreshes monthly listeners + top 5 stream counts per artist."
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
                  ? "Full update (15 min–1 hr): visits every album + every track page to sync complete lifetime stream totals."
                  : "Requires sp_dc session cookie (see above)"
              }
            >
              {isDeepRefreshing ? "Deep refresh…" : "Deep refresh"}
            </button>
          </div>
        </div>
        <div className="mt-4 grid sm:grid-cols-2 gap-3 text-xs text-white/50 leading-relaxed">
          <div className="rounded-lg border border-white/5 bg-black/20 p-3">
            <div className="text-white/80 font-medium mb-1">Refresh</div>
            <div>
              Fast update. Scrapes each artist&apos;s Spotify page to update
              monthly listeners and stream counts for their top 5 tracks.
              Takes about 30 seconds. Runs automatically every day.
            </div>
          </div>
          <div className="rounded-lg border border-white/5 bg-black/20 p-3">
            <div className="text-white/80 font-medium mb-1">Deep refresh</div>
            <div>
              Full update. For every artist, lists every album (via Spotify
              API), scrapes each album for its tracks, then visits every
              individual track page to read its lifetime stream count. Takes
              15 min for a small roster, longer for big ones. Runs
              automatically every Sunday morning via GitHub; click here to
              run manually anytime.
            </div>
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
                designations={designations}
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

      <div className="mt-8">
        <FeaturedSection
          items={press}
          onAdd={addFeatured}
          onRemove={removeFeatured}
        />
      </div>

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
        <h2 className="display text-xl text-white mb-4">Admin password</h2>
        <p className="text-xs text-white/50 mb-4">
          Change the password used to sign into <code>/admin</code>. Minimum 8 characters.
        </p>
        <form onSubmit={changePassword} className="grid md:grid-cols-3 gap-3">
          <input
            type="password"
            value={pwCurrent}
            onChange={(e) => setPwCurrent(e.target.value)}
            placeholder="Current password"
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
            autoComplete="current-password"
            required
          />
          <input
            type="password"
            value={pwNew}
            onChange={(e) => setPwNew(e.target.value)}
            placeholder="New password"
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
            autoComplete="new-password"
            required
          />
          <input
            type="password"
            value={pwConfirm}
            onChange={(e) => setPwConfirm(e.target.value)}
            placeholder="Confirm new password"
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
            autoComplete="new-password"
            required
          />
          <div className="md:col-span-3 flex items-center justify-between text-sm">
            <div className="text-white/50">
              {pwMsg ? <span className="text-green-400">{pwMsg}</span> : null}
              {pwErr ? <span className="text-red-400">{pwErr}</span> : null}
            </div>
            <button
              type="submit"
              disabled={pwSaving || !pwCurrent || !pwNew || !pwConfirm}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
            >
              {pwSaving ? "Updating…" : "Change password"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

function BulkAddArtists({
  onAddBatch,
}: {
  onAddBatch: (urls: string[]) => Promise<{
    added: number;
    duplicate: number;
    failed: number;
    failures: string[];
  }>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [failDetail, setFailDetail] = useState<string[]>([]);

  const urls = text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  async function run() {
    setBusy(true);
    setSummary(null);
    setFailDetail([]);
    const r = await onAddBatch(urls);
    setBusy(false);
    setSummary(
      `Added ${r.added} · ${r.duplicate} already on roster · ${r.failed} failed`,
    );
    setFailDetail(r.failures);
    if (r.added + r.duplicate > 0) setText("");
  }

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-xs text-white/50 hover:text-white underline underline-offset-2"
      >
        {open ? "Hide bulk add ↑" : "Bulk add (paste multiple URLs) ↓"}
      </button>
      {open ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder={
              "Paste multiple Spotify artist URLs or IDs, one per line:\nhttps://open.spotify.com/artist/...\nhttps://open.spotify.com/artist/...\nspotify:artist:..."
            }
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 font-mono resize-y"
          />
          <div className="mt-3 flex items-center justify-between gap-3 text-xs">
            <span className="text-white/40">
              {urls.length === 0 ? "Paste URLs above" : `${urls.length} URL${urls.length === 1 ? "" : "s"}`}
            </span>
            <button
              type="button"
              onClick={run}
              disabled={busy || urls.length === 0}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
            >
              {busy ? `Adding ${urls.length}…` : `Add ${urls.length}`}
            </button>
          </div>
          {summary ? (
            <div className="mt-2 text-xs text-white/60">{summary}</div>
          ) : null}
          {failDetail.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-red-400/80">
                {failDetail.length} failures
              </summary>
              <ul className="mt-1 text-[11px] text-red-400/70 font-mono whitespace-pre-wrap">
                {failDetail.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ArtistRow({
  artist,
  designations,
  expanded,
  onToggle,
  onSave,
  onDelete,
}: {
  artist: Artist;
  designations: string[];
  expanded: boolean;
  onToggle: () => void;
  onSave: (patch: {
    bio?: string;
    socials?: ArtistSocials;
    role?: string;
    designation?: string | null;
  }) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [bio, setBio] = useState(artist.bio ?? "");
  const [role, setRole] = useState(artist.role ?? "");
  const [designation, setDesignation] = useState<string | null>(
    artist.designation ?? null,
  );
  const [socials, setSocials] = useState<ArtistSocials>(
    (artist.socials ?? {}) as ArtistSocials,
  );
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [inlineSaving, setInlineSaving] = useState(false);

  async function save() {
    setSaving(true);
    const ok = await onSave({ bio, role, socials, designation });
    setSaving(false);
    if (ok) {
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 1500);
    }
  }

  // Inline designation change — no row-expand needed
  async function changeDesignationInline(next: string | null) {
    setDesignation(next); // optimistic
    setInlineSaving(true);
    await onSave({ designation: next });
    setInlineSaving(false);
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
        {designations.length > 0 ? (
          <select
            value={designation ?? ""}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => changeDesignationInline(e.target.value || null)}
            disabled={inlineSaving}
            className="hidden sm:block text-xs rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-white/80 hover:text-white focus:outline-none focus:border-white/30 disabled:opacity-50 max-w-[160px]"
            title="Designation"
          >
            <option value="">— Unassigned —</option>
            {designations.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        ) : null}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            {designations.length > 0 ? (
              <div>
                <label className="text-[10px] uppercase tracking-widest text-white/40">
                  Designation
                </label>
                <select
                  value={designation ?? ""}
                  onChange={(e) =>
                    setDesignation(e.target.value || null)
                  }
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
                >
                  <option value="">— Unassigned —</option>
                  {designations.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
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
                ["email", "Email address"],
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
                  placeholder={key === "email" ? "name@example.com" : "https://…"}
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
  // Force re-render every second so the elapsed-time readout ticks live.
  const [, tick] = useState(0);
  useEffect(() => {
    if (run.status !== "running") return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [run.status]);

  const isTrackPhase = run.phase === "tracks";
  const unit = run.kind === "deep"
    ? isTrackPhase ? "tracks" : "albums"
    : "artists";
  const denom = run.kind === "deep"
    ? Math.max(run.albumsTotal, 1)
    : Math.max(run.artistTotal, 1);
  const done = run.kind === "deep" ? run.albumsScraped : run.artistIndex;
  const pct = Math.min(100, Math.round((done / denom) * 100));

  const elapsedSec = Math.max(
    0,
    Math.round((Date.now() - new Date(run.startedAt).getTime()) / 1000),
  );
  // Rough ETA: assume remaining items take same avg as completed ones
  const etaSec =
    done > 0 && denom > 0
      ? Math.max(0, Math.round((elapsedSec / done) * (denom - done)))
      : null;

  const phaseBlurb =
    run.phase === "session"
      ? "Checking your Spotify session cookie"
      : run.phase === "artists"
        ? "Reading each artist's Spotify page for monthly listeners + top 5 stream counts"
        : run.phase === "discovery"
          ? "Asking Spotify's API for each artist's full album list"
          : run.phase === "albums"
            ? "Loading every album page to find every track"
            : run.phase === "isrc"
              ? "Fetching ISRC codes so re-releases can be deduped"
              : run.phase === "tracks"
                ? "Visiting each individual track page to read its lifetime stream count"
                : null;

  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="flex items-baseline justify-between mb-2 gap-3 flex-wrap">
        <div className="text-sm text-white min-w-0">
          <span className="text-white/50">
            {run.kind === "deep" ? "Deep refresh" : "Refresh"} ·{" "}
          </span>
          {run.message ?? run.phase ?? "Working…"}
        </div>
        <div className="text-xs text-white/50 tabular-nums shrink-0">
          {run.kind === "deep"
            ? `${run.albumsScraped}/${run.albumsTotal} ${unit} · ${run.tracksUpserted} upserted`
            : `${run.artistIndex}/${run.artistTotal} ${unit} · ${run.tracksUpserted} tracks`}
        </div>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full bg-[#1db954] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-white/40 flex-wrap">
        <div className="min-w-0">
          {phaseBlurb ? <span>{phaseBlurb}</span> : null}
        </div>
        <div className="tabular-nums shrink-0">
          <span>Elapsed {formatDuration(elapsedSec)}</span>
          {etaSec !== null && run.status === "running" ? (
            <span> · ~{formatDuration(etaSec)} remaining</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h ${mm}m`;
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
