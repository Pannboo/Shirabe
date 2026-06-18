import AllTimeStats, { type SummaryDto } from "@/components/AllTimeStats";
import DecadeChart from "@/components/DecadeChart";
import Heatmap from "@/components/Heatmap";
import HeroCard from "@/components/HeroCard";
import PeriodTabs from "@/components/PeriodTabs";
import ScrobbleFeed from "@/components/ScrobbleFeed";
import SectionTitle from "@/components/SectionTitle";
import StatList from "@/components/StatList";
import TimeHeatmap from "@/components/TimeHeatmap";
import { useApi } from "@/hooks/useApi";
import { useGhostScrobbles } from "@/hooks/useGhostScrobbles";
import { useNowPlaying } from "@/hooks/useNowPlaying";
import type {
  DecadesResponse,
  HeatmapResponse,
  RankedListResponse,
  ScrobblesResponse,
  TimeOfDayResponse,
} from "@/lib/dto";
import type { Period } from "@/lib/format";
import { useState } from "react";

const SCROBBLE_POLL_MS = 10_000;
const TOP_LIST_POLL_MS = 60_000;

export default function PublicDashboard() {
  const [period, setPeriod] = useState<Period>("week");
  const year = new Date().getFullYear();

  const artists = useApi<RankedListResponse>(`/api/public/stats/top-artists?period=${period}`, [period], { pollMs: TOP_LIST_POLL_MS });
  const albums = useApi<RankedListResponse>(`/api/public/stats/top-albums?period=${period}`, [period], { pollMs: TOP_LIST_POLL_MS });
  const tracks = useApi<RankedListResponse>(`/api/public/stats/top-tracks?period=${period}`, [period], { pollMs: TOP_LIST_POLL_MS });
  const recent = useApi<ScrobblesResponse>(`/api/public/scrobbles?limit=25`, [], { pollMs: SCROBBLE_POLL_MS });
  const heatmap = useApi<HeatmapResponse>(`/api/public/stats/heatmap?year=${year}`, [year], { pollMs: 5 * 60_000 });
  const summary = useApi<SummaryDto>(`/api/public/stats/summary`, [], { pollMs: 5 * 60_000 });
  const timeOfDay = useApi<TimeOfDayResponse>(`/api/public/stats/time-of-day`, [], { pollMs: 5 * 60_000 });
  const decades = useApi<DecadesResponse>(`/api/public/stats/decades`, [], { pollMs: 5 * 60_000 });
  const nowPlaying = useNowPlaying();
  const realScrobbles = recent.data?.scrobbles ?? [];
  const ghosts = useGhostScrobbles(nowPlaying, realScrobbles);
  const mergedScrobbles = [...ghosts, ...realScrobbles];

  const artistItems = artists.data?.items ?? [];
  const albumItems = albums.data?.items ?? [];
  const trackItems = tracks.data?.items ?? [];

  return (
    <div className="space-y-14">
      <AllTimeStats summary={summary.data} />

      <div className="flex flex-col items-center gap-2">
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>

      <section>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <SectionTitle>Top artists</SectionTitle>
            <HeroCard item={artistItems[0]} kind="artist" emptyLabel={artists.loading ? "Loading…" : "No artist data yet"} />
            <div className="mt-3">
              <StatList items={artistItems.slice(1, 5)} startRank={2} size="sm" kind="artist" />
            </div>
          </div>
          <div>
            <SectionTitle>Top albums</SectionTitle>
            <HeroCard item={albumItems[0]} kind="album" emptyLabel={albums.loading ? "Loading…" : "No album data yet"} />
            <div className="mt-3">
              <StatList items={albumItems.slice(1, 5)} startRank={2} size="sm" kind="album" />
            </div>
          </div>
          <div>
            <SectionTitle>Top tracks</SectionTitle>
            <StatList items={trackItems.slice(0, 8)} startRank={1} emptyMessage={tracks.loading ? "Loading…" : undefined} kind="track" />
          </div>
        </div>
      </section>

      <section>
        <SectionTitle trailing={`${year}`}>Listening activity</SectionTitle>
        <Heatmap data={heatmap.data?.data ?? []} year={year} />
      </section>

      <section>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <SectionTitle>Time of day</SectionTitle>
            <TimeHeatmap cells={timeOfDay.data?.cells ?? []} />
          </div>
          <div>
            <SectionTitle>By release decade</SectionTitle>
            <DecadeChart
              decades={decades.data?.decades ?? []}
              albumsResolved={decades.data?.albums_resolved ?? 0}
              albumsTotal={decades.data?.albums_total ?? 0}
            />
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>Recent scrobbles</SectionTitle>
        <ScrobbleFeed scrobbles={mergedScrobbles} nowPlaying={nowPlaying} />
      </section>
    </div>
  );
}
