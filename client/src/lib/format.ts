export type Period = "week" | "month" | "year" | "all";

export const PERIODS: Period[] = ["week", "month", "year", "all"];

export function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

export function formatRelative(timestamp: number): string {
  const diff = Date.now() / 1000 - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

export function periodLabel(p: Period): string {
  return { week: "This week", month: "This month", year: "This year", all: "All time" }[p];
}
