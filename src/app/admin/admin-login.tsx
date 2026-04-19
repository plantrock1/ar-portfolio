"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setError("Invalid password");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <main className="mx-auto w-full max-w-md px-6 pt-32 pb-20">
      <h1 className="display text-4xl text-white mb-2">Admin</h1>
      <p className="text-white/50 text-sm mb-8">
        Enter your admin password to manage the roster.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
          autoFocus
        />
        <button
          type="submit"
          disabled={isPending || !password}
          className="rounded-lg bg-white px-4 py-3 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50"
        >
          {isPending ? "Signing in…" : "Sign in"}
        </button>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </form>
    </main>
  );
}
