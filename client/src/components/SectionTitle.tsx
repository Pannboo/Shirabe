import { cn } from "@/lib/utils";

// Now backed by the `.section-title` utility class in globals.css so the
// hairline divider is consistent across every section header in the app.
// Trailing slot keeps its own row; layout matches Koito's TOP TRACKS /
// LAST PLAYED treatment.
export default function SectionTitle({
  children,
  trailing,
  className,
}: {
  children: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("section-title flex items-baseline justify-between gap-3", className)}>
      <span>{children}</span>
      {trailing ? (
        <span className="text-[10px] text-muted-foreground/80 normal-case tracking-normal">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}
