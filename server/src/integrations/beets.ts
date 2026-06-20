import { exec } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { config } from "../config.js";

const pexec = promisify(exec);

// ============================================================================
// Stub override config
// ============================================================================
//
// beets errors out with "can't be both quiet and timid" when the user's
// config has `import.timid: yes` and we pass `-q` on the command line.
// Force-import paths need both: -q so the resolver doesn't hang on a
// prompt, and the user's full library config so files land in the right
// place with the right rules.
//
// Workaround: write a tiny override config at startup that sets
// `import.timid: no`, and pass it as a *second* `-c` flag. beets stacks
// configs and the later one wins for any key it defines, so timid flips
// to no without touching anything else in the user's config.
// ============================================================================

const OVERRIDE_PATH = join(tmpdir(), "shirabe-beets-override.yaml");
mkdirSync(tmpdir(), { recursive: true });
writeFileSync(
  OVERRIDE_PATH,
  "import:\n  timid: no\n  quiet_fallback: skip\n",
);

export interface BeetsResult {
  ok: boolean;
  confidence: number;
  ambiguous: boolean;
  stdout: string;
  stderr: string;
}

// Beets prints similarity in stdout for autotag, e.g. "Similarity: 95.1%".
// We parse that as confidence (0–1). Non-zero only means a candidate was considered.
//
// Beets emits ANSI colour codes by default even when not on a TTY, so the
// captured stdout looks like "Similarity:\x1b[32;01m98.5%\x1b[39;49;00m".
// Strip the escapes before regexing — we also set NO_COLOR in the env
// below, but defending against both belt-and-braces means a beets
// upgrade that ignores NO_COLOR won't silently send every successful
// import to the review queue.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function parseConfidence(stdout: string): number {
  const m = stripAnsi(stdout).match(/Similarity:\s*([0-9.]+)%/i);
  if (!m || !m[1]) return 0;
  return Number(m[1]) / 100;
}

export async function tryBeetsImport(filePath: string): Promise<BeetsResult> {
  const userCfg = config.BEETS_CONFIG ? `-c ${shellQuote(config.BEETS_CONFIG)}` : "";
  // Override goes last so it wins over the user's timid setting.
  const overrideCfg = `-c ${shellQuote(OVERRIDE_PATH)}`;
  const cmd = `${config.BEETS_BIN} ${userCfg} ${overrideCfg} import -q ${shellQuote(filePath)}`;
  try {
    const { stdout, stderr } = await pexec(cmd, {
      timeout: 120000,
      maxBuffer: 5 * 1024 * 1024,
      // NO_COLOR is the universal opt-out understood by colorama (beets'
      // colour layer). With it set, beets stops emitting ANSI escapes
      // and parseConfidence's regex matches without needing the
      // stripAnsi pass — but we keep both as defence-in-depth.
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
    });
    const cleanOut = stripAnsi(stdout);
    const cleanErr = stripAnsi(stderr);
    const confidence = parseConfidence(stdout);
    const ambiguous = /No matching release|skipping|no good match/i.test(cleanOut + cleanErr);
    return {
      ok: confidence >= 0.8 && !ambiguous,
      confidence,
      ambiguous,
      stdout: cleanOut,
      stderr: cleanErr,
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
