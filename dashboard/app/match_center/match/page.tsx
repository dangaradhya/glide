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
import Brand from '@/components/Brand';
import TopTabs from '@/components/TopTabs';
import AuthButton from '@/components/AuthButton';
import BottomNav from '@/components/BottomNav';
import { API_BASE_URL } from '@/lib/api';
import { AVAILABLE_LEAGUES, Match, parseUtc, dayLabel } from '@/lib/leagues';

// Shape of GET /api/matches/:id/summary (see server/index.js): ESPN's per-event box
// score, already normalized server-side. 404s for cricket/tennis and for anything
// ESPN has no summary for - the page then renders the hero alone.
interface CricketBatting {
  name: string; position: number; runs: string; balls: string;
  fours: string; sixes: string; strikeRate: string; dismissal: string;
}
interface CricketBowling {
  name: string; overs: string; maidens: string; runs: string; wickets: string; economy: string;
}
interface CricketInningsData {
  period: number;
  battingTeam: string | null;
  total: string | null;
  batting: CricketBatting[];
  bowling: CricketBowling[];
}

// Cricket responses carry ONLY { innings, venue, attendance } - no home/away/stats -
// so the team-sport fields are optional and every consumer guards on presence.
// Golf responses carry ONLY { leaderboard, round }.
interface GolfLeaderboardRow {
  position: number | null;
  name: string | null;
  flag: string | null;
  // Score-to-par display string ("-8", "E", "+2")
  score: string | null;
  // Strokes per completed round
  rounds: string[];
}
interface MatchSummary {
  home?: { linescores: string[]; record: string | null };
  away?: { linescores: string[]; record: string | null };
  stats?: { label: string; home: string; away: string }[];
  // Soccer only - other sports omit the field entirely
  scorers?: { name: string; minute: string; team: 'home' | 'away'; penalty: boolean; ownGoal: boolean }[];
  // Cricket only - the full scorecard
  innings?: CricketInningsData[];
  // Golf/racing - the event leaderboard + ESPN's round/session status line
  leaderboard?: GolfLeaderboardRow[];
  round?: string | null;
  // UFC only - the bout-by-bout fight card, main event first
  fights?: FightData[];
  venue?: string | null;
  attendance?: number | null;
}
interface FightData {
  status: 'live' | 'final' | 'scheduled';
  fighters: { name: string | null; record: string | null; flag: string | null; winner: boolean }[];
}

// The scorecard endpoint only carries dismissal shorthand ('c', 'b', 'not out') -
// expand the known codes to readable words, pass anything unrecognized through.
const DISMISSAL_LABELS: Record<string, string> = {
  c: 'caught', b: 'bowled', lbw: 'lbw', st: 'stumped', 'run out': 'run out', 'not out': 'not out',
};
const dismissalLabel = (code: string) => DISMISSAL_LABELS[code] ?? code;

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

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

// One cricket innings: header band with team + total, then the batting card and
// bowling figures. Tables scroll horizontally inside their own container on
// narrow screens rather than widening the page.
function InningsCard({ innings }: { innings: CricketInningsData }) {
  return (
    <div className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-950/40 flex items-center justify-between gap-3">
        <span className="font-display font-stretch-[72%] text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 truncate">
          {ordinal(innings.period)} innings{innings.battingTeam ? ` · ${innings.battingTeam}` : ''}
        </span>
        {innings.total && (
          <span className="text-sm font-bold tabular-nums text-gray-900 dark:text-white shrink-0">{innings.total}</span>
        )}
      </div>

      {innings.batting.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[430px]">
            <thead>
              <tr className="font-display font-stretch-[72%] text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
                <th className="text-left font-bold px-4 py-2">Batter</th>
                <th className="text-left font-bold px-2 py-2"></th>
                <th className="font-bold px-2 py-2 text-right w-10">R</th>
                <th className="font-bold px-2 py-2 text-right w-10">B</th>
                <th className="font-bold px-2 py-2 text-right w-9">4s</th>
                <th className="font-bold px-2 py-2 text-right w-9">6s</th>
                <th className="font-bold px-4 py-2 text-right w-14">SR</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {innings.batting.map((b, i) => (
                <tr key={i} className="border-t border-gray-50 dark:border-gray-800/60">
                  <td className="px-4 py-1.5 font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap">{b.name}</td>
                  <td className="px-2 py-1.5 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">{dismissalLabel(b.dismissal)}</td>
                  <td className="px-2 py-1.5 text-right font-bold text-gray-900 dark:text-white">{b.runs}</td>
                  <td className="px-2 py-1.5 text-right text-gray-600 dark:text-gray-300">{b.balls}</td>
                  <td className="px-2 py-1.5 text-right text-gray-600 dark:text-gray-300">{b.fours}</td>
                  <td className="px-2 py-1.5 text-right text-gray-600 dark:text-gray-300">{b.sixes}</td>
                  <td className="px-4 py-1.5 text-right text-gray-600 dark:text-gray-300">{b.strikeRate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {innings.bowling.length > 0 && (
        <div className="overflow-x-auto border-t border-gray-100 dark:border-gray-800">
          <table className="w-full text-[13px] min-w-[380px]">
            <thead>
              <tr className="font-display font-stretch-[72%] text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
                <th className="text-left font-bold px-4 py-2">Bowler</th>
                <th className="font-bold px-2 py-2 text-right w-10">O</th>
                <th className="font-bold px-2 py-2 text-right w-9">M</th>
                <th className="font-bold px-2 py-2 text-right w-10">R</th>
                <th className="font-bold px-2 py-2 text-right w-9">W</th>
                <th className="font-bold px-4 py-2 text-right w-14">Econ</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {innings.bowling.map((bw, i) => (
                <tr key={i} className="border-t border-gray-50 dark:border-gray-800/60">
                  <td className="px-4 py-1.5 font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap">{bw.name}</td>
                  <td className="px-2 py-1.5 text-right text-gray-600 dark:text-gray-300">{bw.overs}</td>
                  <td className="px-2 py-1.5 text-right text-gray-600 dark:text-gray-300">{bw.maidens}</td>
                  <td className="px-2 py-1.5 text-right text-gray-600 dark:text-gray-300">{bw.runs}</td>
                  <td className="px-2 py-1.5 text-right font-bold text-gray-900 dark:text-white">{bw.wickets}</td>
                  <td className="px-4 py-1.5 text-right text-gray-600 dark:text-gray-300">{bw.economy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Event leaderboard, shared by golf and racing: position, competitor (with country
// flag), and - when the sport has them - per-round strokes and a score-to-par total
// (racing exposes finishing order only, so those columns hide themselves). Top 20
// collapsed - a golf field is 150+ players - with the same horizontal-scroll
// containment as the cricket tables. Under-par golf totals get golf's conventional red.
const GOLF_COLLAPSED_ROWS = 20;
function GolfLeaderboard({ leaderboard, round }: { leaderboard: GolfLeaderboardRow[]; round?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? leaderboard : leaderboard.slice(0, GOLF_COLLAPSED_ROWS);
  const roundCols = leaderboard.reduce((n, r) => Math.max(n, r.rounds.length), 0);
  const hasTotals = leaderboard.some(r => r.score != null);

  return (
    <div className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-950/40 flex items-center justify-between gap-3">
        <span className="font-display font-stretch-[72%] text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
          Leaderboard
        </span>
        {round && (
          <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 truncate">{round}</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[360px]">
          <thead>
            <tr className="font-display font-stretch-[72%] text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
              <th className="text-left font-bold px-4 py-2 w-10">Pos</th>
              <th className="text-left font-bold px-2 py-2">Player</th>
              {Array.from({ length: roundCols }, (_, i) => (
                <th key={i} className="font-bold px-2 py-2 text-right w-10">R{i + 1}</th>
              ))}
              {hasTotals && <th className="font-bold px-4 py-2 text-right w-14">Total</th>}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((p, i) => (
              <tr key={i} className="border-t border-gray-50 dark:border-gray-800/60">
                <td className="px-4 py-1.5 text-gray-500 dark:text-gray-400">{p.position ?? '-'}</td>
                <td className="px-2 py-1.5 font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap">
                  {p.flag && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.flag} alt="" className="inline-block w-4 h-3 object-cover rounded-[2px] mr-1.5 align-[-1px]" loading="lazy" />
                  )}
                  {p.name}
                </td>
                {Array.from({ length: roundCols }, (_, ri) => (
                  <td key={ri} className="px-2 py-1.5 text-right text-gray-600 dark:text-gray-300">
                    {p.rounds[ri] ?? '-'}
                  </td>
                ))}
                {hasTotals && (
                  <td className={`px-4 py-1.5 text-right font-bold ${p.score?.startsWith('-') ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                    {p.score ?? '-'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {leaderboard.length > GOLF_COLLAPSED_ROWS && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 transition-colors"
        >
          {expanded ? `Show top ${GOLF_COLLAPSED_ROWS}` : `Show all ${leaderboard.length} players`}
        </button>
      )}
    </div>
  );
}

// UFC fight card: one row per bout, main event first (ESPN's own order). Finished
// bouts read "winner def. loser" with the loser dimmed; live bouts get the pulsing
// dot; upcoming ones a plain "vs". Records ride along in small text.
function FightCard({ fights }: { fights: FightData[] }) {
  return (
    <div className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-950/40">
        <span className="font-display font-stretch-[72%] text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
          Fight card
        </span>
      </div>
      <div className="divide-y divide-gray-50 dark:divide-gray-800/60">
        {fights.map((fight, i) => {
          const [a, b] = fight.status === 'final'
            ? [...fight.fighters].sort((x, y) => (y.winner ? 1 : 0) - (x.winner ? 1 : 0))
            : fight.fighters;
          if (!a || !b) return null;
          const fighter = (f: FightData['fighters'][0], dimmed: boolean) => (
            <span className={`inline-flex items-baseline gap-1.5 min-w-0 ${dimmed ? 'opacity-50' : ''}`}>
              <span className={`truncate ${f.winner ? 'font-bold text-gray-900 dark:text-white' : 'font-medium text-gray-800 dark:text-gray-100'}`}>
                {f.name}
              </span>
              {f.record && (
                <span className="text-[11px] tabular-nums text-gray-400 dark:text-gray-500 shrink-0">{f.record}</span>
              )}
            </span>
          );
          return (
            <div key={i} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                {i === 0 && (
                  <span className="font-display font-stretch-[72%] text-[10px] font-semibold uppercase tracking-widest text-court dark:text-signal/90 mr-1 shrink-0">
                    Main
                  </span>
                )}
                {fighter(a, false)}
                <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                  {fight.status === 'final' ? 'def.' : 'vs'}
                </span>
                {fighter(b, fight.status === 'final')}
              </div>
              <span className="shrink-0 flex items-center gap-1.5">
                {fight.status === 'live' && (
                  <span className="inline-flex rounded-full h-1.5 w-1.5 bg-red-500 animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
                )}
                <span className={`font-display font-stretch-[72%] text-[10px] font-semibold uppercase tracking-wider ${fight.status === 'live' ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
                  {fight.status === 'final' ? 'Final' : fight.status === 'live' ? 'Live' : 'Upcoming'}
                </span>
              </span>
            </div>
          );
        })}
      </div>
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
    // The summary proxies ESPN live and can take seconds on a cache miss, while the
    // match row is a local DB read answering in milliseconds - so the page paints as
    // soon as the row lands and the box score hydrates whenever it arrives, instead
    // of holding the spinner for both (the last source of long spinner holds here).
    // Sentinel semantics preserve the old error behavior exactly: a non-ok summary
    // clears the box score (404 = genuinely none), a network failure keeps whatever
    // was already rendered for the next poll to retry.
    const summaryPromise = fetch(`${API_BASE_URL}/api/matches/${encodeURIComponent(matchId)}/summary`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => undefined);

    try {
      const matchRes = await fetch(`${API_BASE_URL}/api/matches/${encodeURIComponent(matchId)}`);
      if (matchRes.ok) {
        setMatch(await matchRes.json());
      } else if (matchRes.status === 404) {
        setNotFound(true);
      }
    } catch {
      // Keep whatever was already rendered; the next poll retries.
    } finally {
      setLoaded(true);
    }

    const summaryResult = await summaryPromise;
    if (summaryResult !== undefined) setSummary(summaryResult);
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
        <Link href="/match_center" className="px-6 py-2 bg-court text-white font-bold rounded-full hover:bg-signal transition-colors shadow-md">
          Back to Match Center
        </Link>
      </div>
    );
  }

  const isLive = match.status === 'live';
  const isFinal = match.status === 'final';
  const hasScores = match.status !== 'scheduled' && match.home_score != null && match.away_score != null;
  const start = parseUtc(match.start_time);
  // Golf start_times are date-only placeholders from ESPN - appending the
  // clock time would render a fake-precise midnight
  const startLabel = isNaN(start.getTime())
    ? ''
    : match.away_team == null
    ? dayLabel(start)
    : `${dayLabel(start)} · ${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

  const linescoreCols = Math.max(summary?.home?.linescores?.length ?? 0, summary?.away?.linescores?.length ?? 0);

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
              <div className="min-w-0">
                <span className="font-display font-stretch-[72%] text-[11px] uppercase tracking-widest text-white/80 font-bold block">
                  {league?.name ?? match.league_id}
                </span>
                {/* Tennis/cricket context: which tournament, draw, or series this is.
                    Skipped when it just repeats the league name (UFC · UFC) */}
                {match.tournament && match.tournament !== league?.name && (
                  <span className="text-[11px] text-white/70 block truncate">{match.tournament}</span>
                )}
              </div>
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

            {/* Golf: one row = one whole tournament (away_team null by design), so
                the hero is the tournament title + round status + leader line rather
                than a two-sided matchup. */}
            {match.away_team == null ? (
              <div className="flex flex-col items-center pt-1 text-center">
                <h1 className="text-2xl md:text-3xl font-bold text-white leading-tight max-w-xl">
                  {match.home_team}
                </h1>
                <div className="mt-3 flex items-center gap-1.5">
                  {isLive ? (
                    <>
                      <span className="relative flex h-2 w-2" aria-hidden="true">
                        <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-red-300 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-400"></span>
                      </span>
                      <span className="font-display font-stretch-[72%] text-xs font-bold uppercase tracking-wider text-white">
                        Live{match.clock ? ` · ${match.clock}` : ''}
                      </span>
                    </>
                  ) : (
                    <span className="font-display font-stretch-[72%] text-xs font-semibold uppercase tracking-wider text-white/80">
                      {isFinal ? 'Final' : startLabel}
                    </span>
                  )}
                </div>
                {match.status !== 'scheduled' && match.score_summary && (
                  <span className="mt-1.5 text-sm tabular-nums text-white/90">{match.score_summary}</span>
                )}
              </div>
            ) : (
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
                      <span className="font-display font-stretch-[72%] text-xs font-bold uppercase tracking-wider text-white">
                        Live{match.clock ? ` · ${match.clock}` : ''}
                      </span>
                    </>
                  ) : (
                    <span className="font-display font-stretch-[72%] text-xs font-semibold uppercase tracking-wider text-white/80">
                      {isFinal ? 'Final' : startLabel}
                    </span>
                  )}
                </div>

                {/* Set-by-set / innings scoreline for sports without two-integer scores.
                    Constrained + wrapping: cricket's multi-innings lines ("220 & 340
                    (97 ov, target 386) · 295 & 310") otherwise overflow into the badges */}
                {!hasScores && match.status !== 'scheduled' && match.score_summary && (
                  <span className="mt-1.5 text-sm tabular-nums text-white/90 text-center break-words max-w-36 md:max-w-xs">{match.score_summary}</span>
                )}
              </div>

              <TeamBadge src={match.away_logo} name={match.away_team} />
            </div>
            )}

            {(summary?.home?.record || summary?.away?.record) && (
              <div className="flex justify-between mt-2 text-[11px] tabular-nums text-white/70">
                <span className="flex-1 text-center">{summary?.home?.record}</span>
                <span className="shrink-0 w-24"></span>
                <span className="flex-1 text-center">{summary?.away?.record}</span>
              </div>
            )}

            {(isFinal || isLive) && startLabel && (
              <p className="text-center text-[11px] text-white/60 mt-4">{startLabel}</p>
            )}
          </div>
        </div>

        {/* Goalscorers (soccer): who scored and when, split under each team's side.
            (P) = penalty, (OG) = own goal. */}
        {summary?.scorers && summary.scorers.length > 0 && (
          <div className="px-4 py-3 md:px-8 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/40">
            <div className="flex justify-between gap-6 text-[13px] text-gray-700 dark:text-gray-300">
              <div className="flex-1 space-y-1">
                {summary.scorers.filter(s => s.team === 'home').map((s, i) => (
                  <p key={i} className="tabular-nums">
                    {s.name} <span className="text-gray-400 dark:text-gray-500">{s.minute}{s.penalty ? ' (P)' : ''}{s.ownGoal ? ' (OG)' : ''}</span>
                  </p>
                ))}
              </div>
              <span className="shrink-0 font-display font-stretch-[72%] text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 pt-0.5" aria-hidden="true">
                Goals
              </span>
              <div className="flex-1 space-y-1 text-right">
                {summary.scorers.filter(s => s.team === 'away').map((s, i) => (
                  <p key={i} className="tabular-nums">
                    <span className="text-gray-400 dark:text-gray-500">{s.minute}{s.penalty ? ' (P)' : ''}{s.ownGoal ? ' (OG)' : ''}</span> {s.name}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Cricket scorecard: innings-by-innings batting and bowling cards */}
        {summary?.innings && summary.innings.length > 0 && (
          <div>
            {summary.innings.map(inn => (
              <InningsCard key={inn.period} innings={inn} />
            ))}
          </div>
        )}

        {/* Golf/racing leaderboard: the whole point of those detail pages */}
        {summary?.leaderboard && summary.leaderboard.length > 0 && (
          <GolfLeaderboard leaderboard={summary.leaderboard} round={summary.round} />
        )}

        {/* UFC fight card, bout by bout */}
        {summary?.fights && summary.fights.length > 0 && (
          <FightCard fights={summary.fights} />
        )}

        {/* Linescore: per-period/inning/half breakdown when the box score has one */}
        {summary && linescoreCols > 0 && (
          <div className="border-b border-gray-100 dark:border-gray-800 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="font-display font-stretch-[72%] text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  <th className="text-left font-bold px-4 py-2">Team</th>
                  {Array.from({ length: linescoreCols }, (_, i) => (
                    <th key={i} className="font-bold px-2 py-2 text-center w-9">{i + 1}</th>
                  ))}
                  {hasScores && <th className="font-bold px-4 py-2 text-center w-12">T</th>}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {([
                  { name: match.home_team, scores: summary.home?.linescores ?? [], total: match.home_score },
                  { name: match.away_team, scores: summary.away?.linescores ?? [], total: match.away_score },
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
        {summary?.stats && summary.stats.length > 0 && (
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
    <main className="min-h-screen bg-chalk dark:bg-gray-950 text-gray-900 dark:text-white p-4 md:p-8 relative">
      <div className="max-w-6xl mx-auto pb-[calc(6rem_+_var(--app-safe-bottom))] md:pb-8">
        <div className="flex items-center justify-between mb-4">
          <Brand />
          <div className="flex items-center gap-2 md:gap-4">
            <ThemeToggle />
            <AuthButton />
          </div>
        </div>

        {/* The "← Match Center" back link inside the content covers navigation up;
            the tab row just shows where you are, same as the dashboard page */}
        <TopTabs active="match_center" className="mb-8" />

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
