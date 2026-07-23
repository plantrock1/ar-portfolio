import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  isAdmin,
  checkPassword,
  hashPassword,
  setAdminPasswordHash,
} from "@/lib/auth";

export const runtime = "nodejs";

const Body = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "bad request" },
      { status: 400 },
    );
  }
  const { currentPassword, newPassword } = parsed.data;

  // Confirm current password (checks DB hash if set, else env fallback)
  if (!(await checkPassword(currentPassword))) {
    return NextResponse.json(
      { error: "current password is incorrect" },
      { status: 401 },
    );
  }

  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: "new password must differ from current" },
      { status: 400 },
    );
  }

  const hash = await hashPassword(newPassword);
  await setAdminPasswordHash(hash);

  return NextResponse.json({ ok: true });
}
