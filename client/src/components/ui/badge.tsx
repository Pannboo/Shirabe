import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-muted text-foreground",
        success: "bg-green-700/30 text-green-300",
        warning: "bg-yellow-700/30 text-yellow-200",
        danger: "bg-red-700/30 text-red-300",
        info: "bg-blue-700/30 text-blue-200",
        lastfm: "bg-lastfm/20 text-lastfm",
        listenbrainz: "bg-listenbrainz/20 text-listenbrainz",
        musicbrainz: "bg-musicbrainz/20 text-musicbrainz",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
