import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsContext {
  value: string;
  onChange: (v: string) => void;
}

const ctx = React.createContext<TabsContext | null>(null);

export function Tabs({
  value,
  onValueChange,
  className,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <ctx.Provider value={{ value, onChange: onValueChange }}>
      <div className={className}>{children}</div>
    </ctx.Provider>
  );
}

export function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("inline-flex h-9 items-center rounded-md bg-muted p-1 text-muted-foreground", className)}>
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  const c = React.useContext(ctx);
  if (!c) throw new Error("TabsTrigger outside Tabs");
  const active = c.value === value;
  return (
    <button
      type="button"
      onClick={() => c.onChange(value)}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-sm font-medium transition-all",
        active ? "bg-background text-foreground shadow" : "hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
