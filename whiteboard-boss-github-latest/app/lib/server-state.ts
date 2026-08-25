import { env } from "cloudflare:workers";
import { initialSharedData, type SharedData, type User } from "./shared-state";

const STATE_ID = "main";

function db(): D1Database {
  if (!env.DB) throw new Error("共享数据库尚未绑定，请在 Cloudflare 中添加名为 DB 的 D1 绑定。");
  return env.DB;
}

export async function ensureDatabase() {
  const d1 = db();
  await d1.batch([
    d1.prepare("CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at)"),
  ]);
}

export async function loadSharedData(): Promise<SharedData> {
  await ensureDatabase();
  const row = await db().prepare("SELECT data FROM app_state WHERE id = ?").bind(STATE_ID).first<{ data: string }>();
  if (row?.data) return JSON.parse(row.data) as SharedData;
  const state = initialSharedData();
  await saveSharedData(state);
  return state;
}

export async function saveSharedData(state: SharedData) {
  await ensureDatabase();
  await db().prepare("INSERT INTO app_state (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .bind(STATE_ID, JSON.stringify(state), Date.now()).run();
}

export function sessionToken(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  return cookie.split(";").map(x => x.trim()).find(x => x.startsWith("wb_session="))?.slice(11) || "";
}

export async function sessionUser(request: Request, state?: SharedData): Promise<User | null> {
  await ensureDatabase();
  const token = sessionToken(request);
  if (!token) return null;
  const row = await db().prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?").bind(token).first<{ user_id: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  const data = state || await loadSharedData();
  return data.users.find(user => user.id === row.user_id) || null;
}

export async function createSession(userId: string) {
  await ensureDatabase();
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  await db().prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, userId, expiresAt).run();
  return token;
}

export async function deleteSession(token: string) {
  if (!token) return;
  await ensureDatabase();
  await db().prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

export function visibleState(state: SharedData, viewer: User): SharedData {
  if (viewer.role === "owner") return state;
  return { ...state, users: state.users.map(({ passwordHash: _passwordHash, ...user }) => user) };
}

function preservePassword(next: User, previous?: User): User {
  return { ...next, passwordHash: next.passwordHash || previous?.passwordHash || "" };
}

export function mergeAuthorizedState(current: SharedData, incoming: SharedData, actor: User): SharedData {
  if (actor.role === "owner") {
    const before = new Map(current.users.map(user => [user.id, user]));
    const users = incoming.users.map(user => preservePassword(user, before.get(user.id)));
    const owner = users.find(user => user.id === actor.id) || current.users.find(user => user.role === "owner")!;
    return {
      version: 9,
      users: users.map(user => user.id === owner.id ? { ...user, role: "owner", tag: "管理人", approved: true, canManage: true } : user),
      interns: incoming.interns,
      projects: incoming.projects,
      settings: incoming.settings,
    };
  }

  const allowed = new Set(actor.internIds);
  const incomingById = new Map(incoming.interns.map(intern => [intern.id, intern]));
  const interns = current.interns.map(intern => {
    const next = incomingById.get(intern.id);
    if (!next || !allowed.has(intern.id)) return intern;
    if (actor.role === "admin") return next;
    return { ...intern, tasks: next.tasks };
  });
  const submittedSelf = incoming.users.find(user => user.id === actor.id);
  const users = current.users.map(user => user.id === actor.id && submittedSelf
    ? { ...user, avatar: submittedSelf.avatar, passwordHash: submittedSelf.passwordHash || user.passwordHash }
    : user);
  return {
    ...current,
    users,
    interns,
    projects: actor.role === "admin" ? incoming.projects : current.projects,
  };
}
