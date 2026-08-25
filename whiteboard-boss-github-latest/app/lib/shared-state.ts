import type { Intern, Settings } from "./evaluation";
import { defaultSettings } from "./evaluation";

export type Role = "owner" | "admin" | "intern";

export type User = {
  id: string;
  name: string;
  username: string;
  passwordHash?: string;
  role: Role;
  approved: boolean;
  canManage: boolean;
  internIds: string[];
  tag: "实习生" | "管理人";
  avatar?: string;
};

export type SharedData = {
  version: number;
  users: User[];
  interns: Intern[];
  projects: string[];
  settings: Settings;
};

export const ownerAccount: User = {
  id: "whiteboard-boss-owner",
  name: "白板BOSS主号",
  username: "boss_admin",
  passwordHash: "ca2ce44300ad7c4241983af782125fe843f3a2640c24afc2d7f1ccdd6104a2b9",
  role: "owner",
  approved: true,
  canManage: true,
  internIds: [],
  tag: "管理人",
};

export const initialSharedData = (): SharedData => ({
  version: 9,
  users: [ownerAccount],
  interns: [],
  projects: ["星际病院", "魔尊鼠鼠", "海底奇观"],
  settings: { ...defaultSettings },
});
