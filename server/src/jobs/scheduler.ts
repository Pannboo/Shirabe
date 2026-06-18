import cron, { type ScheduledTask } from "node-cron";

const tasks = new Map<string, ScheduledTask>();

export function registerCron(
  name: string,
  schedule: string,
  fn: () => Promise<void> | void,
): void {
  const existing = tasks.get(name);
  if (existing) existing.stop();
  if (!cron.validate(schedule)) {
    console.warn(`[cron:${name}] invalid schedule "${schedule}", skipping`);
    return;
  }
  const task = cron.schedule(schedule, async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[cron:${name}] error`, err);
    }
  });
  tasks.set(name, task);
  console.log(`[cron:${name}] scheduled "${schedule}"`);
}

export function stopAll(): void {
  for (const t of tasks.values()) t.stop();
  tasks.clear();
}
