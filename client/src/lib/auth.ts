import { useEffect, useState } from "react";

const TOKEN_KEY = "shirabe.token";

export interface JwtClaims {
  user_id: number;
  navidrome_user_id: string;
  navidrome_username: string;
  role: "admin" | "listener";
  exp: number;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  window.dispatchEvent(new Event("shirabe:auth"));
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event("shirabe:auth"));
}

export function decode(token: string): JwtClaims | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64)) as JwtClaims;
  } catch {
    return null;
  }
}

export function useAuth(): {
  token: string | null;
  claims: JwtClaims | null;
  isAdmin: boolean;
  isAuthed: boolean;
  signOut: () => void;
} {
  const [token, setT] = useState<string | null>(() => getToken());

  useEffect(() => {
    const onChange = () => setT(getToken());
    window.addEventListener("shirabe:auth", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("shirabe:auth", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const claims = token ? decode(token) : null;
  const expired = !!claims && claims.exp * 1000 < Date.now();
  const valid = !!claims && !expired;

  return {
    token: valid ? token : null,
    claims: valid ? claims : null,
    isAdmin: valid && claims?.role === "admin",
    isAuthed: valid,
    signOut: clearToken,
  };
}
