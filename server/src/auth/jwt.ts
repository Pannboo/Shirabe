import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { Role } from "../types/domain.js";

export interface JwtPayload {
  user_id: number;
  navidrome_user_id: string;
  navidrome_username: string;
  role: Role;
}

const EXPIRES_IN = "30d";

export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, config.SECRET_KEY, { expiresIn: EXPIRES_IN });
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, config.SECRET_KEY) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}
