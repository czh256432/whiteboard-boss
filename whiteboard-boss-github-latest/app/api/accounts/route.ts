import { NextResponse } from "next/server";
import { newIntern } from "../../lib/evaluation";
import { loadSharedData, normalizeIdentityLinks, saveSharedData, sessionUser, visibleState } from "../../lib/server-state";
import type { SharedData, User } from "../../lib/shared-state";

async function ownerState(request: Request) {
  const state = await loadSharedData();
  const actor = await sessionUser(request, state);
  if (!actor) return { error: NextResponse.json({ error: "登录已失效" }, { status: 401 }) };
  if (actor.role !== "owner") return { error: NextResponse.json({ error: "只有管理员主号可以修改账号" }, { status: 403 }) };
  return { state, actor };
}

function response(state: SharedData, actor: User) {
  return NextResponse.json({ state: visibleState(state, actor) });
}

export async function POST(request: Request) {
  try {
    const context = await ownerState(request);
    if ("error" in context) return context.error;
    const body = await request.json() as Pick<User, "name" | "username" | "passwordHash" | "tag">;
    const name = body.name?.trim(), username = body.username?.trim();
    if (!name || !username || !body.passwordHash) return NextResponse.json({ error: "请完整填写姓名、账号和密码" }, { status: 400 });
    if (context.state.users.some(user => user.username.toLowerCase() === username.toLowerCase())) return NextResponse.json({ error: "这个登录账号已经存在" }, { status: 409 });
    const tag = body.tag === "管理人" ? "管理人" : "实习生";
    const profile = tag === "实习生" ? newIntern(name, "") : null;
    const user: User = { id: crypto.randomUUID(), name, username, passwordHash: body.passwordHash, role: tag === "管理人" ? "admin" : "intern", approved: true, canManage: tag === "管理人", internIds: profile ? [profile.id] : [], tag };
    const next = normalizeIdentityLinks({ ...context.state, users: [...context.state.users, user], interns: profile ? [...context.state.interns, profile] : context.state.interns });
    await saveSharedData(next);
    return response(next, context.actor);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建账号失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await ownerState(request);
    if ("error" in context) return context.error;
    const body = await request.json() as { id?: string; patch?: Partial<Pick<User, "tag" | "approved" | "internIds">> };
    const target = context.state.users.find(user => user.id === body.id && user.role !== "owner");
    if (!target) return NextResponse.json({ error: "账号不存在或不能修改主号" }, { status: 404 });
    const patch = body.patch || {};
    let users = context.state.users.map(user => user.id === target.id ? { ...user, ...patch } : user);
    const candidate = users.find(user => user.id === target.id)!;
    if (candidate.tag === "管理人" && patch.internIds) {
      const managerNames = new Set(users.filter(user => user.tag === "管理人").map(user => user.name.trim()));
      const allowedIds = new Set(context.state.interns.filter(intern => !managerNames.has(intern.name.trim())).map(intern => intern.id));
      users = users.map(user => user.id === target.id ? { ...user, internIds: patch.internIds!.filter(id => allowedIds.has(id)) } : user);
    }
    const next = normalizeIdentityLinks({ ...context.state, users });
    await saveSharedData(next);
    return response(next, context.actor);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新账号失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await ownerState(request);
    if ("error" in context) return context.error;
    const { id } = await request.json() as { id?: string };
    const target = context.state.users.find(user => user.id === id && user.role !== "owner");
    if (!target) return NextResponse.json({ error: "账号不存在或不能删除主号" }, { status: 404 });
    const next = normalizeIdentityLinks({ ...context.state, users: context.state.users.filter(user => user.id !== id) });
    await saveSharedData(next);
    return response(next, context.actor);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除账号失败" }, { status: 500 });
  }
}
