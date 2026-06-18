import { cn } from "@/lib/utils";

export default function LiveDot({ label, className }: { label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-accent", className)}>
      <span className="relative inline-flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 live-pulse" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
      </span>
      {label ?? "Live"}
    </span>
  );
}
