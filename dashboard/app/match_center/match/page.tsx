// app/match_center/match/page.tsx
//
// Match detail view - the Phase 2 stretch item. Reached by tapping any row on a
// Match Center scoreboard card. Routed by query param (?id=123) rather than a
// dynamic segment: the static export can't pregenerate unknown match ids, and
// query-param deep links are already this app's established pattern (?reelId= in
// Reels). Deliberately public (no auth gate) so match pages are shareable links.
"use client";

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';
import AuthButton from '@/components/AuthButton';
import BottomNav from '@/components/BottomNav';
import { API_BASE_URL } from '@/lib/api';
import { AVAILABLE_LEAGUES, Match, parseUtc, dayLabel } from '@/lib/leagues';

// Shape of GET /api/matches/:id/summary (see server/index.js): ESPN's per-event box
// score, already normalized server-side. 404s for cricket/tennis and for anything
// ESPN has no summary for - the page then renders the hero alone.
interface MatchSummary {
  home: { linescores: string[]; record: string | null };
  away: { linescores: string[]; record: string | null };
  stats: { label: string; home: string; away: string }[];
  venue: string | null;
  attendance: number | null;
}

const DETAIL_POLL_INTERVAL_MS = 30 * 1000;

function TeamBadge({ src, name }: { src: string | null; name: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-col items-center gap-2 min-w-0 flex-1">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="w-14 h-14 md:w-20 md:h-20 object-contain" onError={() => setFailed(true)} />
      ) : (
        <div className="w-14 h-14 md:w-20 md:h-20 rounded-full bg-white/20 flex items-center justify-center text-white text-xl md:text-3xl font-bold" aria-hidden="true">
          {(name || '?').charAt(0)}
        </div>
      )}
      <span className="text-sm md:text-base font-bold text-white text-center leading-tight">
        {name || 'TBD'}
      </span>
    </div>
  );
}

// One stat comparison row: values at the edges (the better side bold), twin bars
// growing outward from the center when both values are numeric.
function StatRow({ stat }: { stat: { label: string; home: string; away: string } }) {
  const homeNum = parseFloat(stat.home);
  const awayNum = parseFloat(stat.away);
  const numeric = !isNaN(homeNum) && !isNaN(awayNum) && homeNum + awayNum > 0;
  const homePct = numeric ? (homeNum / (homeNum + awayNum)) * 100 : 0;

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={`tabular-nums ${numeric && homeNum > awayNum ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
          {stat.home}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500 text-center">{stat.label}</span>
        <span className={`tabular-nums ${numeric && awayNum > homeNum ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
          {stat.away}
        </span>
      </div>
      {numeric && (
        <div className="flex gap-1 mt-1.5" aria-hidden="true">
          <div className="flex-1 flex justify-end bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div className="h-1 rounded-full bg-blue-500" style={{ width: `${homePct}%` }}></div>
          </div>
          <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div className="h-1 rounded-full bg-purple-500" style={{ width: `${100 - homePct}%` }}></div>
          </div>
        </div>
      )}
    </div>
  );
}

function MatchDetail() {
  const searchParams = useSearchParams();
  const matchId = searchParams.get('id');

  const [match, setMatch] = useState<Match | null>(null);
  const [summary, setSummary] = useState<MatchSummary | null>(null);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [loaded, setLoaded] = useState<boolean>(false);

  const loadMatch = useCallback(async () => {
    if (!matchId) {
      setNotFound(true);
      setLoaded(true);
      return;
    }
    try {
      // The summary 404s for sports without a box score - fetched alongside the
      // match row, never gating it.
      const [matchRes, summaryRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/matches/${encodeURIComponent(matchId)}`),
        fetch(`${API_BASE_URL}/api/matches/${encodeURIComponent(matchId)}/summary`),
      ]);
      if (matchRes.ok) {
        setMatch(await matchRes.json());
      } else if (matchRes.status === 404) {
        setNotFound(true);
      }
      setSummary(summaryRes.ok ? await summaryRes.json() : null);
    } catch {
      // Keep whatever was already rendered; the next poll retries.
    } finally {
      setLoaded(true);
    }
  }, [matchId]);

  // Initial load + a 30s visibility-aware refresh, so a live game's score, clock,
  // and box score keep moving without a manual reload. The backend caches summary
  // responses for 60s, so this polling stays cheap no matter how many viewers.
  useEffect(() => {
    loadMatch();
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') loadMatch();
    }, DETAIL_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [loadMatch]);

  const league = match ? AVAILABLE_LEAGUES.find(l => l.id === match.league_id) : undefined;

  if (!loaded) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (notFound || !match) {
    return (
      <div className="flex flex-col items-center justify-center bg-white dark:bg-gray-900 rounded-xl p-10 border border-gray-200 dark:border-gray-800 shadow-md text-center space-y-4 mt-10">
        <h2 className="text-2xl font-bold">Match not found</h2>
        <p className="text-gray-500 dark:text-gray-400 max-w-md">
          This match may have finished more than a week ago and rolled out of Glide&apos;s window.
        </p>
        <Link href="/match_center" className="px-6 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold rounded-lg hover:shadow-lg hover:opacity-90 transition-all">
          Back to Match Center
        </Link>
      </div>
    );
  }

  const isLive = match.status === 'live';
  const isFinal = match.status === 'final';
  const hasScores = match.status !== 'scheduled' && match.home_score != null && match.away_score != null;
  const start = parseUtc(match.start_time);
  const startLabel = isNaN(start.getTime())
    ? ''
    : `${dayLabel(start)} · ${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

  const linescoreCols = Math.max(summary?.home.linescores.length ?? 0, summary?.away.linescores.length ?? 0);

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href="/match_center"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors mb-4"
      >
        ← Match Center
      </Link>

      <div className="rounded-xl overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-md">
        {/* Hero: league identity gradient carrying the matchup and score */}
        <div className="relative">
          <div className={`absolute inset-0 bg-gradient-to-br ${league?.color ?? 'from-gray-700 to-gray-900'}`}></div>
          <div className="relative px-4 pt-4 pb-6 md:px-8">
            <div className="flex items-center justify-between gap-3 mb-6">
              <span className="text-[11px] uppercase tracking-widest text-white/80 font-bold">
                {league?.name ?? match.league_id}
              </span>
              {league && (
                <a
                  href={league.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-medium text-white/90 bg-black/20 px-2.5 py-1 rounded-full backdrop-blur-sm hover:bg-black/30 transition-colors"
                >
                  Full coverage ↗
                </a>
              )}
            </div>

            <div className="flex items-start justify-between gap-2 md:gap-6">
              <TeamBadge src={match.home_logo} name={match.home_team} />

              <div className="flex flex-col items-center pt-2 shrink-0">
                {hasScores ? (
                  <span className="text-4xl md:text-5xl font-bold tabular-nums text-white">
                    {match.home_score}<span className="text-white/60 mx-2">–</span>{match.away_score}
                  </span>
                ) : (
                  <span className="text-2xl md:text-3xl font-bold text-white/80">vs</span>
                )}

                <div className="mt-2 flex items-center gap-1.5">
                  {isLive ? (
                    <>
                      <span className="relative flex h-2 w-2" aria-hidden="true">
                        <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-red-300 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-400"></span>
                      </span>
                      <span className="text-xs font-bold uppercase tracking-wider text-white">
                        Live{match.clock ? ` · ${match.clock}` : ''}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs font-semibold uppercase tracking-wider text-white/80">
                      {isFinal ? 'Final' : startLabel}
                    </span>
                  )}
                </div>

                {/* Set-by-set / innings scoreline for sports without two-integer scores */}
                {!hasScores && match.status !== 'scheduled' && match.score_summary && (
                  <span className="mt-1.5 text-sm tabular-nums text-white/90">{match.score_summary}</span>
                )}
              </div>

              <TeamBadge src={match.away_logo} name={match.away_team} />
            </div>

            {(summary?.home.record || summary?.away.record) && (
              <div className="flex justify-between mt-2 text-[11px] tabular-nums text-white/70">
                <span className="flex-1 text-center">{summary?.home.record}</span>
                <span className="shrink-0 w-24"></span>
                <span className="flex-1 text-center">{summary?.away.record}</span>
              </div>
            )}

            {(isFinal || isLive) && startLabel && (
              <p className="text-center text-[11px] text-white/60 mt-4">{startLabel}</p>
            )}
          </div>
        </div>

        {/* Linescore: per-period/inning/half breakdown when the box score has one */}
        {summary && linescoreCols > 0 && (
          <div className="border-b border-gray-100 dark:border-gray-800 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  <th className="text-left font-bold px-4 py-2">Team</th>
                  {Array.from({ length: linescoreCols }, (_, i) => (
                    <th key={i} className="font-bold px-2 py-2 text-center w-9">{i + 1}</th>
                  ))}
                  {hasScores && <th className="font-bold px-4 py-2 text-center w-12">T</th>}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {([
                  { name: match.home_team, scores: summary.home.linescores, total: match.home_score },
                  { name: match.away_team, scores: summary.away.linescores, total: match.away_score },
                ]).map((team, idx) => (
                  <tr key={idx} className={idx === 0 ? 'border-b border-gray-50 dark:border-gray-800/60' : ''}>
                    <td className="px-4 py-2 font-semibold text-gray-800 dark:text-gray-100 truncate max-w-32">{team.name}</td>
                    {Array.from({ length: linescoreCols }, (_, i) => (
                      <td key={i} className="px-2 py-2 text-center text-gray-600 dark:text-gray-300">
                        {team.scores[i] ?? '-'}
                      </td>
                    ))}
                    {hasScores && (
                      <td className="px-4 py-2 text-center font-bold text-gray-900 dark:text-white">{team.total}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Team stat comparisons (possession, shots, fouls, ...) when available */}
        {summary && summary.stats.length > 0 && (
          <div className="divide-y divide-gray-50 dark:divide-gray-800/60 py-1">
            {summary.stats.map(stat => (
              <StatRow key={stat.label} stat={stat} />
            ))}
          </div>
        )}

        {(summary?.venue || summary?.attendance) && (
          <p className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-800">
            {summary.venue}
            {summary.venue && summary.attendance ? ' · ' : ''}
            {summary.attendance ? `${summary.attendance.toLocaleString()} attendance` : ''}
          </p>
        )}
      </div>
    </div>
  );
}

export default function MatchDetailPage() {
  return (
    // Same page chrome as the Match Center dashboard, with the detail content
    // Suspense-wrapped because useSearchParams opts the subtree out of the static
    // prerender (per the Next docs) - the fallback matches the loading spinner.
    <main className="min-h-screen bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-white p-4 md:p-8 relative">
      <div className="max-w-6xl mx-auto pb-[calc(6rem_+_var(--app-safe-bottom))] md:pb-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
            Glide
          </h1>
          <div className="flex items-center space-x-4">
            <ThemeToggle />
            <AuthButton />
          </div>
        </div>

        <div className="hidden md:flex justify-center space-x-8 mb-8">
          <Link href="/" className="text-gray-500 dark:text-gray-400 font-bold text-lg hover:text-gray-900 dark:hover:text-white transition-colors">
            Posts
          </Link>
          <Link href="/reels" className="text-gray-500 dark:text-gray-400 font-bold text-lg hover:text-gray-900 dark:hover:text-white transition-colors">
            Reels
          </Link>
          <Link href="/match_center" className="text-gray-900 dark:text-white font-bold text-lg border-b-2 border-purple-500 pb-1">
            Match Center
          </Link>
        </div>

        <Suspense
          fallback={
            <div className="flex justify-center items-center h-64">
              <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          }
        >
          <MatchDetail />
        </Suspense>
      </div>

      <BottomNav active="match_center" />
    </main>
  );
}
