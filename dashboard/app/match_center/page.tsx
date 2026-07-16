// app/match_center/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import AuthButton from '@/components/AuthButton';
// Shared API client - base URL + auto-attached auth header, see lib/api.ts.
// /api/matches is a public no-auth route, so match rows are fetched with plain
// fetch + API_BASE_URL (per lib/api.ts's own convention), while the auth-gated
// preferences routes keep using apiFetch.
import { apiFetch, API_BASE_URL } from '@/lib/api';
import BottomNav from '@/components/BottomNav';

// Added specific destination URLs and visual gradient colors for each league
interface League {
  id: string;
  name: string;
  category: string;
  url: string;
  color: string;
}

// List of popular leagues with their official live score URLs and custom gradient colors for the dashboard cards
const AVAILABLE_LEAGUES: League[] = [
  { id: 'nba', name: 'NBA', category: 'Basketball', url: 'https://www.espn.com/nba/scoreboard', color: 'from-orange-400 to-red-500' },
  { id: 'mlb', name: 'MLB', category: 'Baseball', url: 'https://www.espn.com/mlb/scoreboard', color: 'from-blue-600 to-blue-900' },
  { id: 'nfl', name: 'NFL', category: 'American Football', url: 'https://www.espn.com/nfl/scoreboard', color: 'from-sky-500 to-indigo-600' },
  { id: 'nhl', name: 'NHL', category: 'Hockey', url: 'https://www.espn.com/nhl/scoreboard', color: 'from-cyan-400 to-blue-600' },
  { id: 'cricket', name: 'Intl Cricket', category: 'Cricket', url: 'https://www.espncricinfo.com/live-cricket-match-results', color: 'from-emerald-400 to-teal-600' },
  { id: 'atp', name: "Tennis", category: 'Tennis', url: 'https://www.sofascore.com/tennis', color: 'from-lime-400 to-green-600' },
  { id: 'ufc', name: 'UFC', category: 'MMA', url: 'https://www.espn.com/mma/schedule', color: 'from-red-600 to-red-900' },
  { id: 'f1', name: 'Formula 1', category: 'Motorsport', url: 'https://www.formula1.com/en/racing/2026.html', color: 'from-red-500 to-rose-700' },
  { id: 'premier_league', name: 'Premier League', category: 'Football', url: 'https://www.fotmob.com/leagues/47/overview/premier-league', color: 'from-purple-500 to-indigo-600' },
  { id: 'serie_a', name: 'Serie A', category: 'Football', url: 'https://www.fotmob.com/leagues/55/overview/serie-a', color: 'from-blue-500 to-blue-800' },
  { id: 'la_liga', name: 'La Liga', category: 'Football', url: 'https://www.fotmob.com/leagues/87/overview/la-liga', color: 'from-orange-400 to-red-600' },
  { id: 'bundesliga', name: 'Bundesliga', category: 'Football', url: 'https://www.fotmob.com/leagues/54/overview/bundesliga', color: 'from-red-500 to-neutral-800' },
  { id: 'ligue_1', name: 'Ligue 1', category: 'Football', url: 'https://www.fotmob.com/leagues/53/overview/ligue-1', color: 'from-yellow-400 to-yellow-600' },
  { id: 'champions_league', name: 'UEFA Champions League', category: 'Football', url: 'https://www.fotmob.com/leagues/42/overview/champions-league', color: 'from-indigo-800 to-blue-900' },
  { id: 'europa_league', name: 'UEFA Europa League', category: 'Football', url: 'https://www.fotmob.com/leagues/73/overview/europa-league', color: 'from-orange-500 to-yellow-600' },
  { id: 'conference_league', name: 'UEFA Conference League', category: 'Football', url: 'https://www.fotmob.com/leagues/10216/overview/uefa-conference-league', color: 'from-green-500 to-teal-700' },
  { id: 'world_cup', name: 'FIFA World Cup', category: 'Intl Football', url: 'https://www.fotmob.com/leagues/77/overview/world-cup', color: 'from-amber-600 to-red-700' },
  { id: 'euros', name: 'Euros', category: 'Intl Football', url: 'https://www.fotmob.com/leagues/50/overview/euro', color: 'from-blue-600 to-indigo-800' },
  { id: 'copa_america', name: 'Copa America', category: 'Intl Football', url: 'https://www.fotmob.com/leagues/130/overview/copa-america', color: 'from-sky-400 to-blue-700' },
  { id: 'nations_league', name: 'UEFA Nations League', category: 'Intl Football', url: 'https://www.fotmob.com/leagues/9806/overview/uefa-nations-league', color: 'from-slate-600 to-slate-900' },
];

// Shape of a row from GET /api/matches (see server/index.js). status is always
// normalized to scheduled/live/final at ingestion time. Sports whose score doesn't
// reduce to two integers (tennis sets, cricket innings) carry a human-readable
// score_summary instead, with home_score/away_score left null.
interface Match {
  id: number;
  league_id: string;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
  score_summary: string | null;
  status: string;
  start_time: string;
  clock: string | null;
  last_updated: string;
}

// How stale a league's freshest row can be before the scoreboard card gives way to
// the outbound-link card. ESPN leagues are polled every minute, so 30 minutes means
// a genuinely dead feed, not a hiccup; cricket is on a 20-minute cadence (free-tier
// quota), so it gets a proportionally longer leash. This staleness fallback is also
// the safety net if the unofficial ESPN endpoint ever blocks us outright.
const DEFAULT_STALENESS_MS = 30 * 60 * 1000;
const STALENESS_MS_BY_LEAGUE: Record<string, number> = {
  cricket: 90 * 60 * 1000,
};

const POLL_INTERVAL_MS = 60 * 1000; // matches the backend's own ESPN polling cadence
const COLLAPSED_MATCH_COUNT = 3;
const EXPANDED_MATCH_COUNT = 12;

// SQLite's CURRENT_TIMESTAMP writes UTC but without a timezone marker
// ("2026-07-16 00:34:03"), which new Date() would misread as local time.
// start_time is already ISO-with-Z and passes through untouched.
function parseUtc(value: string): Date {
  return new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
}

// Kickoff labels in the viewer's own timezone: bare time for today,
// "Tomorrow"/weekday prefix otherwise.
function formatStartTime(startTime: string): string {
  const start = parseUtc(startTime);
  if (isNaN(start.getTime())) return '';

  const time = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const now = new Date();
  if (start.toDateString() === now.toDateString()) return time;

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (start.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;

  return `${start.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

// One match inside a league scoreboard card. Three visual states:
// live (pulsing dot + clock), scheduled (kickoff time), final ("Final",
// winner's line at full strength, loser dimmed).
function MatchRow({ match }: { match: Match }) {
  const isLive = match.status === 'live';
  const isFinal = match.status === 'final';
  // ESPN reports 0-0 (not null) for games that haven't started, so a scheduled row
  // never shows its score column - a "0  0" scoreline before kickoff reads as real.
  const hasScores = match.status !== 'scheduled'
    && match.home_score != null && match.away_score != null;

  const homeWon = isFinal && hasScores && match.home_score! > match.away_score!;
  const awayWon = isFinal && hasScores && match.away_score! > match.home_score!;
  const dimmedIfLost = (won: boolean) =>
    isFinal && hasScores && !won ? 'opacity-50' : '';

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        {isLive ? (
          <>
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
              Live{match.clock ? ` · ${match.clock}` : ''}
            </span>
          </>
        ) : (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {isFinal ? 'Final' : formatStartTime(match.start_time)}
          </span>
        )}
      </div>

      <div className="space-y-1">
        <div className={`flex items-baseline justify-between gap-3 ${dimmedIfLost(homeWon)}`}>
          <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate min-w-0">
            {match.home_team}
          </span>
          {hasScores && (
            <span className="text-base font-bold tabular-nums text-gray-900 dark:text-white shrink-0">
              {match.home_score}
            </span>
          )}
        </div>
        <div className={`flex items-baseline justify-between gap-3 ${dimmedIfLost(awayWon)}`}>
          <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate min-w-0">
            {match.away_team}
          </span>
          {hasScores && (
            <span className="text-base font-bold tabular-nums text-gray-900 dark:text-white shrink-0">
              {match.away_score}
            </span>
          )}
        </div>
      </div>

      {/* Set-by-set / innings scoreline for sports that don't reduce to two integers.
          Suppressed for scheduled rows for the same reason as the score column:
          ESPN pre-fills "0 - 0" before kickoff. */}
      {!hasScores && match.status !== 'scheduled' && match.score_summary && (
        <p className="text-xs tabular-nums text-gray-500 dark:text-gray-400 mt-1.5 truncate">
          {match.score_summary}
        </p>
      )}
    </div>
  );
}

// A league with fresh data: gradient identity band up top (doubling as the outbound
// "full coverage" link), real scores below.
function LeagueScoreboardCard({
  league,
  matches,
  expanded,
  onToggleExpanded,
}: {
  league: League;
  matches: Match[];
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const visible = matches.slice(0, expanded ? EXPANDED_MATCH_COUNT : COLLAPSED_MATCH_COUNT);
  const hiddenCount = Math.min(matches.length, EXPANDED_MATCH_COUNT) - COLLAPSED_MATCH_COUNT;

  return (
    <div className="flex flex-col self-start rounded-xl overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow duration-300">
      <a
        href={league.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group relative block"
      >
        <div className={`absolute inset-0 bg-gradient-to-br ${league.color} opacity-90 group-hover:opacity-100 transition-opacity`}></div>
        <div className="relative px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[10px] uppercase tracking-widest text-white/80 font-bold block">
              {league.category}
            </span>
            <h3 className="text-lg font-bold text-white leading-tight">
              {league.name}
            </h3>
          </div>
          <span className="shrink-0 text-[11px] font-medium text-white/90 bg-black/20 px-2.5 py-1 rounded-full backdrop-blur-sm group-hover:bg-black/30 transition-colors">
            Full coverage ↗
          </span>
        </div>
      </a>

      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {visible.map(match => (
          <MatchRow key={match.id} match={match} />
        ))}
      </div>

      {matches.length > COLLAPSED_MATCH_COUNT && (
        <button
          onClick={onToggleExpanded}
          className="w-full px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 transition-colors"
        >
          {expanded ? 'Show fewer' : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}

// A league without usable score data (never ingested, off-season, or a stale/blocked
// feed): the original outbound-link card, unchanged, so the tile always works.
function OutboundLeagueCard({ league }: { league: League }) {
  return (
    <a
      href={league.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative overflow-hidden rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 self-start"
    >
      {/* Dynamic Gradient Background based on League colors */}
      <div className={`absolute inset-0 bg-gradient-to-br ${league.color} opacity-90 group-hover:opacity-100 transition-opacity`}></div>

      <div className="relative p-6 h-full flex flex-col justify-between min-h-[140px]">
        <div>
          <span className="text-[10px] uppercase tracking-widest text-white/80 font-bold mb-1 block">
            {league.category}
          </span>
          <h3 className="text-xl font-bold text-white leading-tight">
            {league.name}
          </h3>
        </div>

        <div className="flex items-center justify-between mt-4">
          <span className="text-sm font-medium text-white/90 bg-black/20 px-3 py-1 rounded-full backdrop-blur-sm">
            Live Updates &rarr;
          </span>
          <svg className="w-5 h-5 text-white transform group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </div>
      </div>
    </a>
  );
}

// The main Match Center component: users pick leagues to follow, and each becomes an
// in-app live scoreboard (with the official coverage link kept as a secondary
// affordance in the card header).
export default function LiveUpdatesPage() {
  // 1. STATE MANAGEMENT
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [preferences, setPreferences] = useState<string[]>([]);
  const [isEditingPreferences, setIsEditingPreferences] = useState<boolean>(false);
  const [selectedLeagues, setSelectedLeagues] = useState<string[]>([]);
  const [preferencesLoading, setPreferencesLoading] = useState<boolean>(true);
  const [matches, setMatches] = useState<Match[]>([]);
  // "Settled" (not "loaded") on purpose: a failed fetch also settles, and the grid
  // then renders every league as an outbound card - degraded, never broken.
  const [matchesSettled, setMatchesSettled] = useState<boolean>(false);
  const [scoresUpdatedAt, setScoresUpdatedAt] = useState<Date | null>(null);
  const [expandedLeagues, setExpandedLeagues] = useState<Set<string>>(new Set());

  // 2. EFFECT TO CHECK AUTHENTICATION AND FETCH PREFERENCES
  useEffect(() => {
    const token = localStorage.getItem('glide_token');

    // If no token is found, the user is not authenticated, so we can skip fetching preferences
    if (!token) {
      setIsAuthenticated(false);
      setPreferencesLoading(false);
      return;
    }

    setIsAuthenticated(true);

    // Fetch user preferences to determine which leagues they have selected
    apiFetch('/api/users/me/preferences')
      .then(async res => {
        // Added session expiration interceptor for the initial load
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem('glide_token');
          localStorage.removeItem('glide_user');
          setIsAuthenticated(false);
          setPreferencesLoading(false);
          return null;
        }
        return res.json();
      })
      .then(data => {
        if (!data) return; // Stop execution if we intercepted an expired token

        if (data.preferences && data.preferences.length > 0) {
          setPreferences(data.preferences);
          setSelectedLeagues(data.preferences);
        } else {
          setIsEditingPreferences(true);
        }
        setPreferencesLoading(false);
      })
      .catch(err => {
        console.error("Error fetching preferences:", err);
        setPreferencesLoading(false);
      });
  }, []);

  // 3. EFFECT TO FETCH + POLL LIVE SCORES
  // One request for all leagues (grouped client-side) rather than one per card,
  // re-polled every minute - but only while the tab is actually visible, and
  // immediately on becoming visible again, so a backgrounded phone tab isn't
  // burning network on scores nobody is watching.
  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;

    const loadMatches = async (skipIfHidden: boolean) => {
      if (skipIfHidden && document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`${API_BASE_URL}/api/matches`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) {
          setMatches(data);
          setScoresUpdatedAt(new Date());
        }
      } catch {
        // Keep whatever data we already had; the staleness check downgrades
        // cards to outbound links on its own if this keeps failing.
      } finally {
        if (!cancelled) setMatchesSettled(true);
      }
    };

    loadMatches(false);
    const intervalId = setInterval(() => loadMatches(true), POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') loadMatches(false);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isAuthenticated]);

  // 4. HANDLERS FOR TOGGLING LEAGUE SELECTION AND SAVING PREFERENCES
  const toggleLeagueSelection = (leagueId: string) => {
    setSelectedLeagues(prev =>
      prev.includes(leagueId) ? prev.filter(id => id !== leagueId) : [...prev, leagueId]
    );
  };

  const savePreferences = async () => {
    const token = localStorage.getItem('glide_token');
    if (!token) return;

    // Save the selected leagues to the backend and update the local state
    try {
      const res = await apiFetch('/api/users/me/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagues: selectedLeagues })
      });

      // Intercept expired tokens during the save action
      if (res.status === 401 || res.status === 403) {
        alert("Your session expired. Please log in again.");
        localStorage.removeItem('glide_token');
        localStorage.removeItem('glide_user');
        setIsAuthenticated(false);
        return;
      }

      if (res.ok) {
        setPreferences(selectedLeagues);
        setIsEditingPreferences(false);
      }
    } catch (err) {
      console.error("Failed to save preferences:", err);
    }
  };

  const toggleExpandedLeague = (leagueId: string) => {
    setExpandedLeagues(prev => {
      const next = new Set(prev);
      if (next.has(leagueId)) next.delete(leagueId);
      else next.add(leagueId);
      return next;
    });
  };

  // Helper to get full league object from string ID
  const activeLeagueData = preferences
    .map(id => AVAILABLE_LEAGUES.find(l => l.id === id))
    .filter(Boolean) as League[];

  // Group match rows by league, preserving the server's ordering (live first, then
  // scheduled soonest-first, then final most-recent-first). Rows without both team
  // names (ESPN emits these for TBD/doubles tennis slots) can't be rendered and are
  // dropped here rather than special-cased everywhere below.
  const matchesByLeague = useMemo(() => {
    const grouped = new Map<string, Match[]>();
    for (const match of matches) {
      if (!match.home_team || !match.away_team) continue;
      const list = grouped.get(match.league_id);
      if (list) list.push(match);
      else grouped.set(match.league_id, [match]);
    }
    return grouped;
  }, [matches]);

  // A league earns a scoreboard card only if it has renderable rows AND its feed is
  // fresh; otherwise null means "fall back to the outbound-link card". Staleness
  // covers both "vendor has nothing for this league" and "our ingestion (or ESPN's
  // unofficial endpoint) died" - the tile keeps working either way. Freshness is
  // measured against when this client last fetched (state, so pure per-render)
  // rather than the wall clock read mid-render.
  const freshMatchesFor = (leagueId: string): Match[] | null => {
    const leagueMatches = matchesByLeague.get(leagueId);
    if (!leagueMatches || leagueMatches.length === 0 || !scoresUpdatedAt) return null;

    const freshest = Math.max(...leagueMatches.map(m => parseUtc(m.last_updated).getTime()));
    const threshold = STALENESS_MS_BY_LEAGUE[leagueId] ?? DEFAULT_STALENESS_MS;
    if (scoresUpdatedAt.getTime() - freshest > threshold) return null;

    return leagueMatches;
  };

  return (
    // No extra top padding needed here for the notch - <body>'s pt-[var(--app-banner-height)]
    // (see layout.tsx) already reserves that space for every page. Adding it again here
    // would double-count the notch inset on top of what body already reserves.
    <main className="min-h-screen bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-white p-4 md:p-8 relative">

      {/* Bottom padding clears the mobile bottom nav bar. Grows by the safe-area inset (same
          var used on the nav bar below) for the same reason the nav bar itself does */}
      <div className="max-w-4xl mx-auto pb-[calc(6rem_+_var(--app-safe-bottom))] md:pb-8">

        {/* Header Section */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
            Glide
          </h1>

          <div className="flex items-center space-x-4">
            <ThemeToggle />
            <AuthButton />
          </div>
        </div>

        {/* Navigation Section */}
        {/* HIGHLIGHT: Hidden on mobile (hidden md:flex), safely centered on desktop */}
        <div className="hidden md:flex justify-center space-x-8 mb-8">
          <Link href="/" className="text-gray-500 dark:text-gray-400 font-bold text-lg hover:text-gray-900 dark:hover:text-white transition-colors">
            Posts
          </Link>
          <Link href="/reels" className="text-gray-500 dark:text-gray-400 font-bold text-lg hover:text-gray-900 dark:hover:text-white transition-colors">
            Reels
          </Link>
          <span className="text-gray-900 dark:text-white font-bold text-lg border-b-2 border-purple-500 pb-1 cursor-default">
            Match Center
          </span>
        </div>

        {/* Main Content Area - Conditional rendering based on authentication and preferences state.
            The spinner also holds until the first scores fetch settles, so the dashboard never
            flashes outbound-link cards and then swaps them for scoreboards a beat later. */}
        {(isAuthenticated === null || preferencesLoading || (isAuthenticated && !isEditingPreferences && !matchesSettled)) ? (
          <div className="flex justify-center items-center h-64">
             <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) :

        isAuthenticated === false ? (
          <div className="flex flex-col items-center justify-center bg-white dark:bg-gray-900 rounded-xl p-10 border border-gray-200 dark:border-gray-800 shadow-md text-center space-y-6 mt-10">
            <div className="p-4 bg-purple-100 dark:bg-purple-900/20 rounded-full">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h2 className="text-3xl font-bold mb-2">Match Center Portal</h2>
              <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                Sign in to customize your dashboard with official real-time scores, schedules, and standings.
              </p>
            </div>
          </div>
        ) :

        isEditingPreferences ? (
          <div className="bg-white dark:bg-gray-900 rounded-xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-md animate-in fade-in zoom-in duration-300">
            <div className="mb-6 border-b border-gray-100 dark:border-gray-800 pb-4">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Build Your Dashboard</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Select the leagues you want to track. Live scores show up right here in Glide.</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {AVAILABLE_LEAGUES.map((league) => {
                const isSelected = selectedLeagues.includes(league.id);
                return (
                  <div
                    key={league.id}
                    onClick={() => toggleLeagueSelection(league.id)}
                    className={`cursor-pointer border rounded-lg p-4 flex flex-col items-center justify-center text-center space-y-2 transition-all duration-200 ${
                      isSelected
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/10 shadow-sm ring-1 ring-purple-500'
                        : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="absolute top-2 right-2">
                      {isSelected && (
                        <svg className="w-4 h-4 text-purple-600 dark:text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{league.category}</span>
                    <span className={`text-sm font-semibold ${isSelected ? 'text-purple-700 dark:text-purple-300' : 'text-gray-700 dark:text-gray-200'}`}>
                      {league.name}
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="flex justify-end space-x-4 border-t border-gray-100 dark:border-gray-800 pt-4">
              {preferences.length > 0 && (
                <button
                  onClick={() => {
                    setSelectedLeagues(preferences);
                    setIsEditingPreferences(false);
                  }}
                  className="px-6 py-2 rounded-lg font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={savePreferences}
                disabled={selectedLeagues.length === 0}
                className="px-6 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold rounded-lg hover:shadow-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                Save Launchpad
              </button>
            </div>
          </div>
        ) :

        (
        <div className="w-full flex flex-col bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden shadow-md dark:shadow-lg transition-all duration-300">

          <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3 bg-white dark:bg-gray-900">
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
                Your Match Center
              </h2>
              {scoresUpdatedAt && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                  Updated {scoresUpdatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · refreshes every minute
                </p>
              )}
            </div>
            <button
              onClick={() => setIsEditingPreferences(true)}
              className="shrink-0 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-md transition-colors"
            >
              ⚙️ Manage Dashboard
            </button>
          </div>

          <div className="p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 items-start bg-gray-50 dark:bg-gray-950/40">
            {activeLeagueData.map(league => {
              const freshMatches = freshMatchesFor(league.id);
              return freshMatches ? (
                <LeagueScoreboardCard
                  key={league.id}
                  league={league}
                  matches={freshMatches}
                  expanded={expandedLeagues.has(league.id)}
                  onToggleExpanded={() => toggleExpandedLeague(league.id)}
                />
              ) : (
                <OutboundLeagueCard key={league.id} league={league} />
              );
            })}
          </div>
        </div>
        )}
      </div>

      {/* Mobile Bottom Navigation Bar (Hidden on Desktop) */}
      {/* h-16 (4rem) is the CONTENT height; the safe-area inset is added on top of that,
          not carved out of it - Tailwind's border-box sizing means a fixed height plus bottom
          padding alone would shrink the usable content area on tall insets */}
      <BottomNav active="match_center" />

    </main>
  );
}
