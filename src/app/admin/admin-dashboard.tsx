"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { Artist } from "@/lib/db/schema";

export function AdminDashboard({
  initialArtists,
}: {
  initialArtists: Artist[];
}) {
  const router = useRouter();
  const [artists, setArtists] = useState(initialArtists);
  const [spotifyUrl, setSpotifyUrl] = useState("");
  const [role, setRole] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, startAdding] = useTransition();
  const [isRefreshing, startRefresh] = useTransition();

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

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
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
        </div>
        <button
          onClick={logout}
          className="text-xs text-white/40 hover:text-white"
        >
          Sign out
        </button>
      </div>

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
        <div className="mt-4 flex items-center justify-between text-sm">
          <div className="text-white/50">
            {message ? <span className="text-green-400">{message}</span> : null}
            {error ? <span className="text-red-400">{error}</span> : null}
          </div>
          <button
            onClick={refreshNow}
            disabled={isRefreshing}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-50"
          >
            {isRefreshing ? "Refreshing…" : "Refresh now"}
          </button>
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
