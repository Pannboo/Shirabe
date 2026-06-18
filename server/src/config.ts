import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

// In dev the server runs from server/, so .env is one level up at the repo root.
// In prod (Docker / npm start) it runs from the repo root, so the local .env works too.
loadDotenv({ path: resolve(process.cwd(), "../.env") });
loadDotenv();


const schema = z.object({
  SECRET_KEY: z.string().min(16, "SECRET_KEY must be at least 16 chars"),
  DATABASE_URL: z.string().default("./data/shirabe.db"),
  PORT: z.coerce.number().int().positive().default(3000),
  NAVIDROME_URL: z.string().url().default("http://localhost:4533"),
  ALLOWED_ORIGINS: z.string().default(""),
  PUBLIC_FRONTEND_ORIGIN: z.string().default("http://localhost:5173"),
  BEETS_BIN: z.string().default("beet"),
  BEETS_CONFIG: z.string().default(""),
  DOWNLOADS_DIR: z.string().default("./downloads"),
  MUSIC_DIR: z.string().default("./music"),
  NODE_ENV: z.string().default("development"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
};

export type Config = typeof config;
