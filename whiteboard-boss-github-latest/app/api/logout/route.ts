import { NextResponse } from "next/server";
import { deleteSession, sessionToken } from "../../lib/server-state";

export async function POST(request: Request) {
  await deleteSession(sessionToken(request));
  const response = NextResponse.json({ ok: true });
  response.cookies.set("wb_session", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
