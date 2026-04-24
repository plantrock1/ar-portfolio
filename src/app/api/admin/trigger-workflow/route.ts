import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/auth";

export const runtime = "nodejs";

const Body = z.object({ type: z.enum(["shallow", "deep"]) });

const REPO_OWNER = "plantrock1";
const REPO_NAME = "ar-portfolio";

export async function GET() {
  // Used by the admin UI to decide whether to show the GitHub-trigger
  // buttons. Public to admin users only.
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.GITHUB_PAT;
  const slug = process.env.GITHUB_AR_SLUG;
  return NextResponse.json({
    configured: Boolean(token && slug),
    slug: slug ?? null,
  });
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.GITHUB_PAT;
  const slug = process.env.GITHUB_AR_SLUG;
  if (!token || !slug) {
    return NextResponse.json(
      {
        error:
          "GitHub trigger not configured. Add GITHUB_PAT + GITHUB_AR_SLUG env vars in Vercel, then redeploy.",
      },
      { status: 500 },
    );
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const workflow = `${parsed.data.type}-refresh-${slug}.yml`;
  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ar-portfolio-admin",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    return NextResponse.json(
      { error: `GitHub ${res.status}: ${errText.slice(0, 300)}` },
      { status: 502 },
    );
  }

  const workflowUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${workflow}`;
  return NextResponse.json({ ok: true, workflow, workflowUrl });
}
