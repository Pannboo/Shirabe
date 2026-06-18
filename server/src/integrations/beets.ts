import { exec } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";

const pexec = promisify(exec);

export interface BeetsResult {
  ok: boolean;
  confidence: number;
  ambiguous: boolean;
  stdout: string;
  stderr: string;
}

// Beets prints similarity in stdout for autotag, e.g. "Similarity: 95.1%".
// We parse that as confidence (0–1). Non-zero only means a candidate was considered.
function parseConfidence(stdout: string): number {
  const m = stdout.match(/Similarity:\s*([0-9.]+)%/i);
  if (!m || !m[1]) return 0;
  return Number(m[1]) / 100;
}

export async function tryBeetsImport(filePath: string): Promise<BeetsResult> {
  const cfgFlag = config.BEETS_CONFIG ? `-c ${shellQuote(config.BEETS_CONFIG)}` : "";
  const cmd = `${config.BEETS_BIN} ${cfgFlag} import -q ${shellQuote(filePath)}`;
  try {
    const { stdout, stderr } = await pexec(cmd, { timeout: 120000, maxBuffer: 5 * 1024 * 1024 });
    const confidence = parseConfidence(stdout);
    const ambiguous = /No matching release|skipping|no good match/i.test(stdout + stderr);
    return {
      ok: confidence >= 0.8 && !ambiguous,
      confidence,
      ambiguous,
      stdout,
      stderr,
    };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      confidence: 0,
      ambiguous: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? "",
    };
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
