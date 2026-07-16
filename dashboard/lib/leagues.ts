// dashboard/lib/leagues.ts
//
// The Match Center league catalog: id (matches the backend's matches.league_id and
// user_preferences.league_id vocabularies), display name/category, the official
// live-coverage URL (used as each scoreboard card's secondary outbound affordance and
// as the whole card for leagues without score data), and the card's gradient identity.
// Shared between the Match Center dashboard and the match detail page - previously
// inlined in app/match_center/page.tsx.

export interface League {
  id: string;
  name: string;
  category: string;
  url: string;
  color: string;
}

export const AVAILABLE_LEAGUES: League[] = [
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
// score_summary instead, with home_score/away_score left null. Logos are ESPN CDN
// URLs, null for tennis (athletes, not teams) and cricket.
export interface Match {
  id: number;
  league_id: string;
  home_team: string | null;
  away_team: string | null;
  home_logo: string | null;
  away_logo: string | null;
  home_score: number | null;
  away_score: number | null;
  score_summary: string | null;
  status: string;
  start_time: string;
  clock: string | null;
  last_updated: string;
}

// SQLite's CURRENT_TIMESTAMP writes UTC but without a timezone marker
// ("2026-07-16 00:34:03"), which new Date() would misread as local time.
// start_time is already ISO-with-Z and passes through untouched.
export function parseUtc(value: string): Date {
  return new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
}

// Calendar-day label in the viewer's own timezone. Full date (not a bare weekday)
// beyond yesterday/today/tomorrow: a Serie A fixture five weeks out labeled just
// "Sat" reads as *this* Saturday.
export function dayLabel(date: Date): string {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return 'Today';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays === 1) return 'Tomorrow';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
