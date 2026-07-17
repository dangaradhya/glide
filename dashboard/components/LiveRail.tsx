// components/LiveRail.tsx
//
// Desktop-only scores rail beside the Posts feed - the first piece of layout that
// treats desktop as its own surface instead of a stretched phone. Fed by the same
// public /api/matches route as Match Center. Fill order keeps the rail alive around
// the clock: live matches first, then soon-upcoming fixtures (next 48h), then
// recently-finished results (last 48h), capped at MAX_ROWS. Logged-in users with
// launchpad picks see only their leagues - matching Match Center's own filtering -
// unless that leaves the rail empty, in which case it falls back to all leagues
// (a filled rail beats a hidden one; the per-row league label keeps it honest).
// Renders nothing when there's no data at all or the fetch fails - the feed's flex
// layout then re-centers on its own. The rail is decorative: never an error state.
"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { API_BASE_URL, apiFetch } from '@/lib/api';
import { AVAILABLE_LEAGUES, Match, parseUtc } from '@/lib/leagues';

const POLL_INTERVAL_MS = 60 * 1000; // matches Match Center's own polling cadence
const MAX_ROWS = 8;
const FILL_WINDOW_MS = 48 * 3600 * 1000;

function railRows(rows: Match[], preferredLeagues: string[] | null): Match[] {
  let named = rows.filter(m => m.home_team && m.away_team);
  if (preferredLeagues && preferredLeagues.length > 0) {
    const filtered = named.filter(m => preferredLeagues.includes(m.league_id));
    if (filtered.length > 0) named = filtered;
  }

  const now = Date.now();
  const live = named.filter(m => m.status === 'live');

  const upcoming = named
    .filter(m => m.status === 'scheduled')
    .filter(m => {
      const t = parseUtc(m.start_time).getTime();
      return t > now && t <= now + FILL_WINDOW_MS;
    })
    .sort((a, b) => parseUtc(a.start_time).getTime() - parseUtc(b.start_time).getTime());

  const finished = named
    .filter(m => m.status === 'final')
    .filter(m => {
      const t = parseUtc(m.start_time).getTime();
      return t >= now - FILL_WINDOW_MS;
    })
    .sort((a, b) => parseUtc(b.start_time).getTime() - parseUtc(a.start_time).getTime());

  return [...live, ...upcoming, ...finished].slice(0, MAX_ROWS);
}

// Kickoff label: time alone for today, "Sat 7:30 PM" beyond that
function kickoffLabel(startTime: string): string {
  const start = parseUtc(startTime);
  if (isNaN(start.getTime())) return '';
  const time = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const now = new Date();
  const sameDay = start.getFullYear() === now.getFullYear()
    && start.getMonth() === now.getMonth() && start.getDate() === now.getDate();
  return sameDay ? time : `${start.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

function RailRow({ match }: { match: Match }) {
  const league = AVAILABLE_LEAGUES.find(l => l.id === match.league_id);
  const isLive = match.status === 'live';
  const isFinal = match.status === 'final';
  const hasScores = !isLive && !isFinal ? false : match.home_score != null && match.away_score != null;
  const timeLabel = isLive ? (match.clock || 'Live') : isFinal ? 'Final' : kickoffLabel(match.start_time);

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
        ) : ((isLive || isFinal) && match.score_summary) ? (
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
  // null = no preference filtering (logged out, no picks yet, or the call failed)
  const [preferredLeagues, setPreferredLeagues] = useState<string[] | null>(null);
  const [prefsResolved, setPrefsResolved] = useState(false);

  // Resolve launchpad picks once - the same route Match Center filters by, so the
  // rail and the dashboard always agree on which leagues a user follows
  useEffect(() => {
    if (!localStorage.getItem('glide_token')) {
      setPrefsResolved(true);
      return;
    }
    apiFetch('/api/users/me/preferences')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data?.preferences?.length > 0) setPreferredLeagues(data.preferences);
      })
      .catch(() => { /* no filtering beats no rail */ })
      .finally(() => setPrefsResolved(true));
  }, []);

  useEffect(() => {
    if (!prefsResolved) return;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/matches`);
        if (!res.ok) return;
        setRows(railRows(await res.json(), preferredLeagues));
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
  }, [prefsResolved, preferredLeagues]);

  if (!loaded || rows.length === 0) return null;
  const anyLive = rows.some(m => m.status === 'live');

  return (
    <aside className="hidden lg:block w-80 shrink-0">
      <div className="sticky top-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-md dark:shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <span className="font-display font-stretch-[72%] font-semibold uppercase tracking-[0.09em] text-xs text-gray-900 dark:text-white">
            {anyLive ? 'Live now' : 'Scores & fixtures'}
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
