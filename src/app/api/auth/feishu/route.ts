import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { authorizeUrl } from "@/lib/feishu";
import { appUrl, BASE_PATH } from "@/lib/paths";

export async function GET(req: NextRequest) {
  const state = crypto.randomBytes(12).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(appUrl(req.nextUrl.origin) + "/api/auth/feishu/callback", state));
  res.cookies.set("yy_fs_state", state, { httpOnly: true, sameSite: "lax", path: BASE_PATH || "/", maxAge: 600 });
  return res;
}
