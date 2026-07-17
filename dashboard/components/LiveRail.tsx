// components/LiveRail.tsx
//
// Desktop-only "Live now" rail beside the Posts feed - the first piece of layout
// that treats desktop as its own surface instead of a stretched phone. Fed by the
// existing public /api/matches route (no auth, same as Match Center); shows live
// matches first, falls back to today's upcoming games, and renders nothing at all
// when there's neither - the feed's flex layout then re-centers on its own, so the
// page never shows an empty box. Rows link to the match detail view. The rail is
// decorative: a failed fetch just means no rail, never an error state.
"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { AVAILABLE_LEAGUES, Match, parseUtc } from '@/lib/leagues';

const POLL_INTERVAL_MS = 60 * 1000; // matches Match Center's own polling cadence
const MAX_ROWS = 8;

function railRows(rows: Match[]): Match[] {
  const named = rows.filter(m => m.home_team && m.away_team);
  const live = named.filter(m => m.status === 'live');
  if (live.length > 0) return live.slice(0, MAX_ROWS);

  // Nothing live: today's still-upcoming games, soonest first
  const now = Date.now();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  return named
    .filter(m => m.status === 'scheduled')
    .filter(m => {
      const t = parseUtc(m.start_time).getTime();
      return t > now && t <= endOfDay.getTime();
    })
    .sort((a, b) => parseUtc(a.start_time).getTime() - parseUtc(b.start_time).getTime())
    .slice(0, MAX_ROWS);
}

function RailRow({ match }: { match: Match }) {
  const league = AVAILABLE_LEAGUES.find(l => l.id === match.league_id);
  const isLive = match.status === 'live';
  const hasScores = isLive && match.home_score != null && match.away_score != null;
  const kickoff = parseUtc(match.start_time);
  const timeLabel = isLive
    ? (match.clock || 'Live')
    : isNaN(kickoff.getTime()) ? '' : kickoff.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <Link
      href={`/match_center/match?id=${match.id}`}
      className="block px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-display font-stretch-[72%] font-semibold uppercase tracking-[0.07em] text-[10px] text-gray-400 dark:text-gray-500 truncate">
          {league?.name || match.league_id}
        </span>
        <span className={`font-display font-stretch-[72%] font-semibold uppercase tracking-[0.07em] text-[10px] shrink-0 ${isLive ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'}`}>
          {isLive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse motion-reduce:animate-none mr-1 align-middle" aria-hidden="true"></span>}
          {timeLabel}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-gray-800 dark:text-gray-100 truncate">
          {match.home_team} <span className="text-gray-400">vs</span> {match.away_team}
        </span>
        {hasScores ? (
          <span className="font-bold tabular-nums text-gray-900 dark:text-white shrink-0">
            {match.home_score}–{match.away_score}
          </span>
        ) : (isLive && match.score_summary) ? (
          <span className="font-bold tabular-nums text-gray-900 dark:text-white shrink-0 text-xs truncate max-w-[90px]">
            {match.score_summary}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

export default function LiveRail() {
  const [rows, setRows] = useState<Match[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/matches`);
        if (!res.ok) return;
        setRows(railRows(await res.json()));
      } catch {
        // Decorative rail: a failed fetch means no rail, never an error state
      } finally {
        setLoaded(true);
      }
    };
    load();
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);

  if (!loaded || rows.length === 0) return null;
  const anyLive = rows.some(m => m.status === 'live');

  return (
    <aside className="hidden lg:block w-80 shrink-0">
      <div className="sticky top-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-md dark:shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <span className="font-display font-stretch-[72%] font-semibold uppercase tracking-[0.09em] text-xs text-gray-900 dark:text-white">
            {anyLive ? 'Live now' : 'Up next today'}
          </span>
          {anyLive && <span className="w-2 h-2 rounded-full bg-live animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>}
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map(m => <RailRow key={m.id} match={m} />)}
        </div>
        <Link
          href="/match_center"
          className="block px-4 py-2.5 text-center font-display font-stretch-[72%] font-semibold uppercase tracking-[0.09em] text-[11px] text-court dark:text-signal hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors border-t border-gray-100 dark:border-gray-800"
        >
          Full Match Center
        </Link>
      </div>
    </aside>
  );
}
