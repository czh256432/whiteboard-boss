import { NextResponse } from "next/server";
import { createSession, loadSharedData, visibleState } from "../../lib/server-state";

export async function POST(request: Request) {
  try {
    const { username, passwordHash } = await request.json() as { username?: string; passwordHash?: string };
    const state = await loadSharedData();
    const user = state.users.find(item => item.username === username && item.passwordHash === passwordHash);
    if (!user) return NextResponse.json({ error: "账号或密码不正确" }, { status: 401 });
    if (!user.approved) return NextResponse.json({ error: "账号暂未允许登录" }, { status: 403 });
    const token = await createSession(user.id);
    const response = NextResponse.json({ user: { ...user, passwordHash: undefined }, state: visibleState(state, user) });
    response.cookies.set("wb_session", token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "登录服务暂不可用" }, { status: 500 });
  }
}
