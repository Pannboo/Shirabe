// Schema is applied inside db/client.ts at module load time so that any query
// module can prepare statements during its own import evaluation. Keep this
// export as a no-op so index.ts (and any other call sites) still work.
export function migrate(): void {
  /* applied in db/client.ts */
}
