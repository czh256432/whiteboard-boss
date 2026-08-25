import { NextResponse } from "next/server";
import { loadSharedData, sessionUser, visibleState } from "../../lib/server-state";

export async function GET(request: Request) {
  try {
    const state = await loadSharedData();
    const user = await sessionUser(request, state);
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    return NextResponse.json({ user: { ...user, passwordHash: undefined }, state: visibleState(state, user) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "同步服务暂不可用" }, { status: 500 });
  }
}
