import { db } from "../client.js";
import type { Role, User } from "../../types/domain.js";

const insert = db.prepare(`
  INSERT INTO users (navidrome_user_id, username, role) VALUES (?, ?, ?)
`);
const byNavidromeId = db.prepare(`SELECT * FROM users WHERE navidrome_user_id = ?`);
const byId = db.prepare(`SELECT * FROM users WHERE id = ?`);
const adminCount = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'admin'`);
const adminId = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
const setRole = db.prepare(`UPDATE users SET role = ? WHERE id = ?`);

export function getUserByNavidromeId(navidromeId: string): User | undefined {
  return byNavidromeId.get(navidromeId) as User | undefined;
}

export function getUserById(id: number): User | undefined {
  return byId.get(id) as User | undefined;
}

export function createUser(
  navidromeId: string,
  username: string,
  role: Role,
): User {
  const result = insert.run(navidromeId, username, role);
  return getUserById(Number(result.lastInsertRowid))!;
}

export function getAdminId(): number | null {
  const row = adminId.get() as { id: number } | undefined;
  return row?.id ?? null;
}

export function hasAdmin(): boolean {
  const row = adminCount.get() as { c: number };
  return row.c > 0;
}

export function promoteToAdmin(userId: number): void {
  setRole.run("admin", userId);
}
