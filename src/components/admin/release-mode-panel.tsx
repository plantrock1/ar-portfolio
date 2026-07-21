"use client";

import { useEffect, useState } from "react";

// Admin UI for release-mode deployments (SITE_MODE=releases). Two buttons:
//
//   - "Refresh releases from Spotify" — hits /api/cron/refresh-releases
//     (dual-authed to accept the admin cookie), populating latest_releases
//     for the roster.
//   - "Connect Airtable" / "Sync now" — OAuth handshake + sync of
//     upcoming_releases from the configured base + table.
//
// Only rendered when siteMode === "releases" in the parent dashboard.

export type AirtableStatus = {
  connected: boolean;
  baseId: string | null;
  tableName: string | null;
  syncStatus: string;
  lastSyncedAt: string | null;
  lastError: string | null;
};

type Base = { id: string; name: string };
type Table = { id: string; name: string };

export function ReleaseModePanel({
  initialStatus,
}: {
  initialStatus: AirtableStatus | null;
}) {
  const [status, setStatus] = useState<AirtableStatus | null>(initialStatus);
  const [bases, setBases] = useState<Base[] | null>(null);
  const [tables, setTables] = useState<Table[] | null>(null);
  const [loadingBases, setLoadingBases] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshingReleases, setRefreshingReleases] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Callback flag from ?airtable=connected/error after the OAuth round trip.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("airtable");
    if (flag === "connected") {
      setMessage("Airtable connected.");
      refreshStatus();
    } else if (flag === "error") {
      setError(params.get("message") ?? "OAuth failed");
    }
    if (flag) {
      // Clean up so a hard refresh doesn't retrigger the banner.
      params.delete("airtable");
      params.delete("message");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : ""),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshStatus() {
    // Cheap round-trip: fetch bases returns 401 if disconnected. We keep
    // status in local state instead of re-fetching from a dedicated
    // endpoint since the parent server component already gave us the
    // initial snapshot; on connect we optimistically flip it and a
    // background sync will fix any drift.
    if (!status?.connected) {
      setStatus((s) => (s ? { ...s, connected: true } : s));
    }
  }

  async function loadBases() {
    setLoadingBases(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/airtable/config", {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "load failed");
      setBases(data.bases ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load bases failed");
    } finally {
      setLoadingBases(false);
    }
  }

  async function loadTables(baseId: string) {
    setLoadingTables(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/airtable/config?tablesFor=${encodeURIComponent(baseId)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "load failed");
      setTables(data.tables ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load tables failed");
    } finally {
      setLoadingTables(false);
    }
  }

  async function saveConfig(baseId: string | null, tableName: string | null) {
    setSavingConfig(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/airtable/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseId, tableName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "save failed");
      setStatus((s) => (s ? { ...s, baseId, tableName } : s));
      setMessage("Config saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSavingConfig(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Airtable? Upcoming releases will stop syncing.")) {
      return;
    }
    setError(null);
    setMessage(null);
    const res = await fetch("/api/admin/airtable/disconnect", {
      method: "POST",
    });
    if (res.ok) {
      setStatus({
        connected: false,
        baseId: null,
        tableName: null,
        syncStatus: "idle",
        lastSyncedAt: null,
        lastError: null,
      });
      setBases(null);
      setTables(null);
      setMessage("Airtable disconnected.");
    } else {
      setError("Disconnect failed.");
    }
  }

  async function syncNow() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/airtable/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "sync failed");
      let msg = `Synced. Fetched ${data.fetched}, upserted ${data.upserted}, removed ${data.removed}, skipped ${data.skipped}.`;
      if (data.upserted === 0 && data.sampleFieldNames?.length) {
        msg +=
          ` Airtable columns seen: ${data.sampleFieldNames.join(", ")}. Rename or add these to your table to match: Title, Release Date, Artist (or Spotify Artist ID).`;
      } else if (data.errors?.length && data.upserted < data.fetched) {
        msg += ` First skip reason: ${data.errors[0].reason}`;
      }
      setMessage(msg);
      setStatus((s) =>
        s
          ? {
              ...s,
              syncStatus: "done",
              lastSyncedAt: new Date().toISOString(),
              lastError: data.errors?.length ? data.errors[0].reason : null,
            }
          : s,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "sync failed";
      setError(message);
      setStatus((s) =>
        s ? { ...s, syncStatus: "error", lastError: message } : s,
      );
    } finally {
      setSyncing(false);
    }
  }

  async function refreshReleases() {
    setRefreshingReleases(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/cron/refresh-releases", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "refresh failed");
      setMessage(
        `Refreshed ${data.updated}/${data.total} artists' latest releases. ${data.skipped} skipped.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "refresh failed");
    } finally {
      setRefreshingReleases(false);
    }
  }

  return (
    <section className="rounded-xl border border-white/5 bg-white/[0.02] p-6 mb-8">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="display text-xl text-white">Releases</h2>
        <span className="text-xs text-white/40">Release-mode deployment</span>
      </div>

      {/* Spotify latest-release refresh -------------------------------- */}
      <div className="border-b border-white/5 pb-5 mb-5">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[10px] uppercase tracking-widest text-white/40">
            Latest release · Spotify
          </div>
        </div>
        <p className="text-xs text-white/50 mb-3">
          Pulls each artist&apos;s most recent album/single from Spotify and
          caches it for the artist page. Runs daily via cron; click to force
          a refresh now.
        </p>
        <button
          type="button"
          onClick={refreshReleases}
          disabled={refreshingReleases}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-50"
        >
          {refreshingReleases ? "Refreshing…" : "Refresh releases from Spotify"}
        </button>
      </div>

      {/* Airtable connection ------------------------------------------- */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[10px] uppercase tracking-widest text-white/40">
            Upcoming releases · Airtable
          </div>
          <div className="text-[10px] text-white/40">
            {status?.connected ? (
              <span className="text-green-400">Connected</span>
            ) : (
              <span className="text-white/40">Not connected</span>
            )}
          </div>
        </div>
        <p className="text-xs text-white/50 mb-3">
          Reads upcoming release rows from an Airtable base with Title,
          Release Date, and Spotify Artist ID columns. Syncs daily; click
          Sync now to force it.
        </p>

        {!status?.connected ? (
          <a
            href="/api/admin/airtable/authorize"
            className="inline-block rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
          >
            Connect Airtable
          </a>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-white/40">
                  Base
                </label>
                {bases ? (
                  <select
                    value={status.baseId ?? ""}
                    onChange={(e) => {
                      const id = e.target.value || null;
                      setStatus((s) => (s ? { ...s, baseId: id } : s));
                      setTables(null);
                      if (id) loadTables(id);
                    }}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
                  >
                    <option value="">— Choose a base —</option>
                    {bases.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    type="button"
                    onClick={loadBases}
                    disabled={loadingBases}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 text-left hover:text-white disabled:opacity-50"
                  >
                    {loadingBases
                      ? "Loading bases…"
                      : status.baseId
                        ? status.baseId
                        : "Click to load bases…"}
                  </button>
                )}
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-white/40">
                  Table
                </label>
                {tables ? (
                  <select
                    value={status.tableName ?? ""}
                    onChange={(e) => {
                      const t = e.target.value || null;
                      setStatus((s) => (s ? { ...s, tableName: t } : s));
                    }}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
                  >
                    <option value="">— Choose a table —</option>
                    {tables.map((t) => (
                      <option key={t.id} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={status.tableName ?? ""}
                    onChange={(e) =>
                      setStatus((s) =>
                        s ? { ...s, tableName: e.target.value || null } : s,
                      )
                    }
                    placeholder={
                      loadingTables ? "Loading tables…" : "Table name"
                    }
                    disabled={loadingTables}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  saveConfig(status.baseId, status.tableName)
                }
                disabled={
                  savingConfig || !status.baseId || !status.tableName
                }
                className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
              >
                {savingConfig ? "Saving…" : "Save"}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-white/50">
              {status.lastSyncedAt ? (
                <span>
                  Last synced{" "}
                  {new Date(status.lastSyncedAt).toLocaleString()}
                </span>
              ) : (
                <span>Never synced</span>
              )}
              {status.syncStatus === "error" && status.lastError ? (
                <span className="text-red-400">
                  Last error: {status.lastError}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={syncNow}
                disabled={
                  syncing || !status.baseId || !status.tableName
                }
                className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
              >
                {syncing ? "Syncing…" : "Sync now"}
              </button>
              <button
                type="button"
                onClick={disconnect}
                className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/70 hover:text-white hover:bg-white/5"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}

        {message ? (
          <div className="mt-3 text-xs text-green-400">{message}</div>
        ) : null}
        {error ? (
          <div className="mt-3 text-xs text-red-400">{error}</div>
        ) : null}
      </div>
    </section>
  );
}
