import { NextResponse } from "next/server";
import { loadSharedData, mergeAuthorizedState, saveSharedData, sessionUser, visibleState } from "../../lib/server-state";
import type { SharedData } from "../../lib/shared-state";

export async function PUT(request: Request) {
  try {
    const current = await loadSharedData();
    const actor = await sessionUser(request, current);
    if (!actor) return NextResponse.json({ error: "登录已失效" }, { status: 401 });
    const incoming = await request.json() as SharedData;
    const next = mergeAuthorizedState(current, incoming, actor);
    await saveSharedData(next);
    const refreshedActor = next.users.find(user => user.id === actor.id) || actor;
    return NextResponse.json({ state: visibleState(next, refreshedActor) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 500 });
  }
}
