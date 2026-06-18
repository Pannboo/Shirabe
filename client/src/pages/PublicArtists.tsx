import { useState } from "react";
import StatList from "@/components/StatList";
import PeriodTabs from "@/components/PeriodTabs";
import SectionTitle from "@/components/SectionTitle";
import { useApi } from "@/hooks/useApi";
import type { RankedListResponse } from "@/lib/dto";
import type { Period } from "@/lib/format";

export default function PublicArtists() {
  const [period, setPeriod] = useState<Period>("all");
  const { data, loading } = useApi<RankedListResponse>(`/api/public/stats/top-artists?period=${period}`, [period]);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">Top artists</h2>
        <PeriodTabs value={period} onChange={setPeriod} align="start" />
      </div>
      <section>
        <SectionTitle>Ranked</SectionTitle>
        <StatList items={data?.items ?? []} emptyMessage={loading ? "Loading…" : "No scrobbles yet."} kind="artist" />
      </section>
    </div>
  );
}
