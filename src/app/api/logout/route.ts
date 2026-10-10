import { NextRequest, NextResponse } from "next/server";
import { appUrl, BASE_PATH } from "@/lib/paths";
import { SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(appUrl(req.nextUrl.origin) + "/login?logout=1", 303);
  res.cookies.set(SESSION_COOKIE, "", { path: BASE_PATH || "/", maxAge: 0 });
  return res;
}
