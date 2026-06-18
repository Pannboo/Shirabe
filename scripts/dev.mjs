// Dev launcher. Bypasses node_modules/.bin/ shims (which don't populate on NTFS)
// and runs binaries via `sh -c` to avoid spawn quirks with spaces in the cwd.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function binFromPkg(pkg, key) {
  const pkgPath = require.resolve(`${pkg}/package.json`);
  const json = require(pkgPath);
  const rel = typeof json.bin === "string" ? json.bin : json.bin[key ?? pkg];
  return resolve(dirname(pkgPath), rel);
}

const tsxBin = binFromPkg("tsx");
const viteBin = binFromPkg("vite");

function sh(name, color, cwd, cmd) {
  // Pass the command as a single shell-quoted string. shell:true → /bin/sh -c.
  const child = spawn(cmd, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: "/bin/sh",
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m`;
  child.stdout.on("data", (b) => process.stdout.write(b.toString().replace(/^/gm, `${prefix} `)));
  child.stderr.on("data", (b) => process.stderr.write(b.toString().replace(/^/gm, `${prefix} `)));
  child.on("exit", (code) => {
    console.log(`${prefix} exited (${code})`);
    process.exit(code ?? 0);
  });
  return child;
}

function quote(p) {
  return `'${p.replace(/'/g, "'\\''")}'`;
}

const serverCmd = `node ${quote(tsxBin)} watch src/index.ts`;
const clientCmd = `node ${quote(viteBin)}`;

const server = sh("server", "34", resolve(root, "server"), serverCmd);
const client = sh("client", "35", resolve(root, "client"), clientCmd);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.kill(sig);
    client.kill(sig);
  });
}
