// server/liveScores.js
//
// Live-score ingestion for Match Center. Mirrors scraper.js's pattern: this file is
// require()'d once from index.js after the server binds, doesn't touch the database
// directly, and instead POSTs normalized results to a scraper-key-authenticated route
// (/api/matches) - same separation the existing posts/reels pipeline uses.
//
// Everything now comes from ESPN's public endpoints (no API key, no visible rate limit):
// - site.api.espn.com per-league scoreboards cover football/NBA/MLB/NFL/NHL/Tennis,
//   polled every minute - close to real "live".
// - site.web.api.espn.com's scoreboard header feed covers ALL current cricket in one
//   request (series names + human-readable innings scores), polled every 5 minutes.
//   This replaced CricketData.org (Match Center v3), whose free tier had a hard
//   100 req/day quota and had started serving days-stale "live" matches.
// NOTE: these are undocumented, unofficial endpoints (the same ones espn.com's own
// frontend calls) - there's no published SLA and reuse likely isn't authorized under
// ESPN's ToS. Accepted as a known risk (flagged in the roadmap); if they ever get
// blocked, affected leagues fall back to the outbound-link cards via the frontend's
// staleness check, same as any vendor outage would.
// F1 and MMA are deliberately excluded - both exist on ESPN too, but neither fits the
// two-teams-with-a-score shape (F1 is a multi-entrant race with a finishing order, MMA is a
// 1-on-1 fight decided by method, not a score) - revisit with a schema that fits them later.
require('dotenv').config();
const cron = require('node-cron');

const PORT = process.env.PORT || 3000;
const MATCHES_API_URL = `http://127.0.0.1:${PORT}/api/matches`;

// The league_id -> ESPN (sport, slug) map lives in espnLeagues.js so the box-score
// summary route in index.js can share it without require()ing this file's cron
// side effects. See that file for the tennis-two-tours and verified-slugs notes.
const { ESPN_LEAGUES } = require('./espnLeagues');

// The fixtures sweep window: how far back and forward the hourly date-range fetch
// reaches. Backward covers "last matchday" on the frontend (and must stay under
// index.js's 10-day matches retention cutoff); forward covers "next matchday" even
// for leagues between seasons, whose next fixture can be weeks out.
const FIXTURES_DAYS_BACK = 7;
const FIXTURES_DAYS_AHEAD = 21;

// Cricket's forward window is deliberately shorter than the team sports': a cricket
// fan decides around the next week of play, T20 leagues schedule densely enough that
// +10 days still fills the card, and every extra day is one more discovery request
// per hourly sweep (see runCricketFixturesCycle).
const CRICKET_FIXTURES_DAYS_AHEAD = 10;

// ESPN's status.type.state is a clean 3-value model across every sport it covers - much
// simpler than chasing per-sport in-progress codes the way API-Sports required.
function normalizeEspnStatus(state) {
    if (state === 'pre') return 'scheduled';
    if (state === 'post') return 'final';
    return 'live';
}

function normalizeEspnEvent(event, league_id) {
    const comp = event.competitions[0];
    const home = comp.competitors.find((c) => c.homeAway === 'home');
    const away = comp.competitors.find((c) => c.homeAway === 'away');
    const status = normalizeEspnStatus(comp.status.type.state);

    const homeScore = home && home.score !== undefined ? parseInt(home.score, 10) : null;
    const awayScore = away && away.score !== undefined ? parseInt(away.score, 10) : null;

    return {
        league_id,
        vendor: 'espn',
        external_id: event.id,
        home_team: home ? home.team.displayName : null,
        away_team: away ? away.team.displayName : null,
        home_logo: home?.team?.logo || null,
        away_logo: away?.team?.logo || null,
        home_score: Number.isNaN(homeScore) ? null : homeScore,
        away_score: Number.isNaN(awayScore) ? null : awayScore,
        score_summary: `${Number.isNaN(homeScore) ? '?' : homeScore} - ${Number.isNaN(awayScore) ? '?' : awayScore}`,
        status,
        start_time: event.date,
        // Only meaningful mid-game; ESPN's shortDetail is a formatted start time for
        // scheduled events (e.g. "7/16 - 7:00 PM EDT"), not a live clock.
        clock: status === 'live' ? comp.status.type.shortDetail : null,
        // Team sports don't need one - the league card already names the competition
        tournament: null,
    };
}

// Tennis' scoreboard shape is structurally different from every team sport: an "event" here
// is a whole TOURNAMENT (e.g. "Nordea Open"), and the individual matches are nested inside
// event.groupings[] (one grouping per draw - Women's Singles, Men's Singles, etc.), each with
// its own competitions[] array. Competitors use `.athlete.displayName` instead of
// `.team.displayName`, and there's no single score number - `linescores` is a per-set array
// (e.g. two sets, 6-2 6-2), which score_summary joins into "6-2, 6-2" the same way cricket's
// per-innings score gets flattened into a display string.
function normalizeEspnTennisMatch(match, league_id, tournament) {
    const home = match.competitors.find((c) => c.homeAway === 'home');
    const away = match.competitors.find((c) => c.homeAway === 'away');
    const status = normalizeEspnStatus(match.status.type.state);

    const setScores = (home?.linescores || []).map((set, i) => {
        const awaySet = away?.linescores?.[i];
        return awaySet ? `${set.value}-${awaySet.value}` : null;
    }).filter(Boolean);

    const competitorName = (c) => c?.athlete?.displayName || c?.team?.displayName || null;

    return {
        league_id,
        vendor: 'espn',
        external_id: match.id,
        home_team: competitorName(home),
        away_team: competitorName(away),
        // Tennis competitors are athletes, not teams - there's no logo to carry
        home_logo: null,
        away_logo: null,
        home_score: null,
        away_score: null,
        score_summary: setScores.length > 0 ? setScores.join(', ') : null,
        status,
        start_time: match.date,
        clock: status === 'live' ? match.status.type.shortDetail : null,
        tournament,
    };
}

// dateRange (optional, "YYYYMMDD-YYYYMMDD") widens the fetch from "today's scoreboard"
// to a whole window - used by the hourly fixtures sweep. Omitted for the every-minute
// live cycle, where today's default response is exactly what's wanted.
async function fetchEspnLeague({ league_id, sport, slug }, dateRange) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${slug}/scoreboard${dateRange ? `?dates=${dateRange}` : ''}`;
    const res = await fetch(url);
    const json = await res.json();
    const events = json.events || [];

    if (sport === 'tennis') {
        // A tennis "event" is a whole tournament; the draw name (Men's Singles /
        // Women's Singles / ...) lives on the grouping. "Tournament · Draw" is what
        // the frontend groups rows under - it's also how men's and women's matches
        // stop being jumbled together in one anonymous list.
        return events.flatMap((event) =>
            (event.groupings || []).flatMap((grouping) => {
                const tournament = [
                    event.shortName || event.name,
                    grouping.grouping?.displayName,
                ].filter(Boolean).join(' · ') || null;
                return (grouping.competitions || []).map((match) => normalizeEspnTennisMatch(match, league_id, tournament));
            })
        );
    }

    return events.map((event) => normalizeEspnEvent(event, league_id));
}

// ESPN's scoreboard header feed is the one cricket endpoint that returns EVERYTHING
// currently on (all active series/leagues in one request) - the per-league scoreboard
// pattern used for other sports needs per-series slugs that change constantly, which is
// why cricket originally went to CricketData.org instead. Shape differences from the
// team-sport scoreboard: events sit under sports[0].leagues[].events[], status is a bare
// 'pre'/'in'/'post' string, and competitor `score` is already a human-readable innings
// line ("279/4 (96 ov)") rather than a number - so home_score/away_score stay null and
// score_summary carries the display text, same contract cricket rows always had. The
// series name (league.name) goes in `tournament`, prefixed with the match title when
// ESPN provides one ("2nd Youth Test"). `summary` ("Stumps", "Lunch", ...) is the
// closest thing cricket has to a live clock, so it rides in `clock`.
const CRICKET_HEADER_URL = 'https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket';
const cricketSeriesScoreboardUrl = (seriesId, date) =>
    `https://site.web.api.espn.com/apis/site/v2/sports/cricket/${seriesId}/scoreboard${date ? `?dates=${date}` : ''}`;

// A multi-week series' calendar can hold dozens of match days; the in-window slice is
// additionally capped so one T20 league can't turn the hourly sweep into a request storm.
const CRICKET_MAX_DATES_PER_SERIES = 12;

function normalizeCricketHeaderEvent(event, league) {
    const home = (event.competitors || []).find((c) => c.homeAway === 'home');
    const away = (event.competitors || []).find((c) => c.homeAway === 'away');
    const status = normalizeEspnStatus(event.status);

    const scoreSummary = [home?.score, away?.score]
        .filter((s) => s && String(s).trim() !== '')
        .join(' · ') || null;

    return {
        league_id: 'cricket',
        vendor: 'espn',
        external_id: `cricket-${event.id}`,
        // The scorecard summary endpoint is addressed by series + event; the series id
        // is stored so match detail keeps working even after a finished series rotates
        // out of the header feed (a request-time header lookup couldn't find it then)
        series_id: String(league.id),
        home_team: home?.displayName || home?.name || null,
        away_team: away?.displayName || away?.name || null,
        home_logo: null,
        away_logo: null,
        home_score: null,
        away_score: null,
        score_summary: scoreSummary,
        status,
        start_time: event.date || null,
        clock: status === 'live' ? (event.summary || null) : null,
        tournament: [event.title, league.name].filter(Boolean).join(' · ') || null,
    };
}

// The per-series scoreboard uses the standard scoreboard shape (competitions[0]
// .competitors[].team) - unlike the header feed - but cricket scores are still
// display strings ("220 & 340 (97 ov, target 386)"), never two integers.
function normalizeCricketScoreboardEvent(event, series) {
    const comp = event.competitions[0];
    const home = comp.competitors.find((c) => c.homeAway === 'home');
    const away = comp.competitors.find((c) => c.homeAway === 'away');
    const status = normalizeEspnStatus(comp.status.type.state);

    const scoreSummary = [home?.score, away?.score]
        .filter((s) => s && String(s).trim() !== '')
        .join(' · ') || null;

    // event.description reads "2nd Youth Test, <series> at <venue>, Jul 17-20 2026" -
    // its leading segment is the same short title the header feed calls `title`
    const title = (event.description || '').split(',')[0].trim() || null;

    return {
        league_id: 'cricket',
        vendor: 'espn',
        external_id: `cricket-${event.id}`,
        series_id: String(series.id),
        home_team: home?.team?.displayName || null,
        away_team: away?.team?.displayName || null,
        home_logo: null,
        away_logo: null,
        home_score: null,
        away_score: null,
        score_summary: status === 'scheduled' ? null : scoreSummary,
        status,
        start_time: event.date,
        clock: status === 'live' ? comp.status.type.shortDetail : null,
        tournament: [title, series.name].filter(Boolean).join(' · ') || null,
    };
}

async function fetchCricket() {
    const res = await fetch(CRICKET_HEADER_URL);
    const json = await res.json();
    const leagues = json.sports?.[0]?.leagues || [];
    return leagues.flatMap((league) =>
        (league.events || []).map((event) => normalizeCricketHeaderEvent(event, league))
    );
}

async function postMatchesBatch(matches, label) {
    if (matches.length === 0) {
        console.log(`   ℹ️ No ${label} matches fetched this cycle.`);
        return;
    }
    try {
        const res = await fetch(MATCHES_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-scraper-key': process.env.SCRAPER_KEY,
            },
            body: JSON.stringify({ matches }),
        });
        const body = await res.json();
        if (res.ok) {
            console.log(`   💾 [${label}] Upserted ${body.upserted ?? matches.length} matches.`);
        } else {
            console.error(`   ⚠️ [${label}] /api/matches rejected the batch:`, JSON.stringify(body));
        }
    } catch (err) {
        console.error(`   ⚠️ [${label}] Failed to POST matches batch:`, err.message);
    }
}

async function runEspnCycle() {
    console.log('🏟️  Starting ESPN live scores cycle...');
    const allMatches = [];
    for (const league of ESPN_LEAGUES) {
        try {
            allMatches.push(...(await fetchEspnLeague(league)));
        } catch (err) {
            console.error(`   ⚠️ Failed to fetch ESPN ${league.sport}/${league.slug}:`, err.message);
        }
    }
    await postMatchesBatch(allMatches, 'ESPN');
    console.log('🏁 ESPN live scores cycle complete!');
}

// Hourly fixtures sweep: pulls the past-week results + upcoming-fixtures window for
// every TEAM-sport league, so the frontend can show "last matchday" and "next
// matchday" instead of only whatever happens to be on today's scoreboard. Tennis is
// deliberately excluded: it has no matchday concept, runs hundreds of matches per
// day (a multi-week window would dwarf every other league combined), and its
// today-only data already comes from the every-minute cycle above.
async function runEspnFixturesCycle() {
    console.log('📅 Starting ESPN fixtures sweep...');
    const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
    const from = new Date(Date.now() - FIXTURES_DAYS_BACK * 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + FIXTURES_DAYS_AHEAD * 24 * 60 * 60 * 1000);
    const dateRange = `${fmt(from)}-${fmt(to)}`;

    const allMatches = [];
    for (const league of ESPN_LEAGUES) {
        if (league.sport === 'tennis') continue;
        try {
            allMatches.push(...(await fetchEspnLeague(league, dateRange)));
        } catch (err) {
            console.error(`   ⚠️ Failed fixtures fetch ESPN ${league.sport}/${league.slug}:`, err.message);
        }
    }
    await postMatchesBatch(allMatches, 'ESPN fixtures');
    console.log('🏁 ESPN fixtures sweep complete!');
}

// Hourly cricket fixtures sweep - cricket's version of runEspnFixturesCycle, so
// cricket cards get "last matchday + upcoming" day sections like team sports do.
// Two stages:
//   1. DISCOVERY - which series exist? There's no stable league list for cricket
//      (series ids are born and die with each tour/season), and the bare header
//      feed only names series with a match TODAY. But it accepts ?dates=YYYYMMDD,
//      so asking it once per day across the whole sweep window surfaces every
//      series with any match in-window - including tours whose first match is
//      days away and series that already finished (previously undiscoverable 
//      once their id left today's header).
//   2. EXPANSION - each discovered series' bare scoreboard exposes a calendar of
//      its match days, and single-date queries return finished matches with full
//      scores plus future fixtures (the ?dates=A-B range form 404s for cricket,
//      so days are fetched individually). Only calendar days inside the window
//      are requested, so stale or far-future matches never enter the DB at all.
async function runCricketFixturesCycle() {
    console.log('🏏📅 Starting cricket fixtures sweep...');
    try {
        const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
        const from = Date.now() - FIXTURES_DAYS_BACK * 24 * 60 * 60 * 1000;
        const to = Date.now() + CRICKET_FIXTURES_DAYS_AHEAD * 24 * 60 * 60 * 1000;

        // Stage 1: one header call per window day, series deduped by id. A failed
        // date is skipped rather than failing the sweep - worst case that day's
        // exclusive series get discovered by a later sweep.
        const seriesById = new Map();
        for (let t = from; t <= to; t += 24 * 60 * 60 * 1000) {
            try {
                const res = await fetch(`${CRICKET_HEADER_URL}&dates=${fmt(new Date(t))}`);
                const json = await res.json();
                for (const league of (json.sports?.[0]?.leagues || [])) {
                    if (league.id && !seriesById.has(String(league.id))) {
                        seriesById.set(String(league.id), { id: league.id, name: league.name });
                    }
                }
            } catch (err) {
                console.error(`   ⚠️ Failed cricket header discovery for ${fmt(new Date(t))}:`, err.message);
            }
        }
        const seriesList = [...seriesById.values()];
        console.log(`   🔎 Discovered ${seriesList.length} cricket series in window.`);
        const allMatches = [];

        for (const series of seriesList) {
            try {
                const baseRes = await fetch(cricketSeriesScoreboardUrl(series.id));
                const baseJson = await baseRes.json();
                const dates = (baseJson.leagues?.[0]?.calendar || [])
                    .map((d) => new Date(d))
                    .filter((d) => !isNaN(d.getTime()) && d.getTime() >= from && d.getTime() <= to)
                    .slice(0, CRICKET_MAX_DATES_PER_SERIES)
                    .map((d) => d.toISOString().slice(0, 10).replace(/-/g, ''));

                for (const date of dates) {
                    const res = await fetch(cricketSeriesScoreboardUrl(series.id, date));
                    const json = await res.json();
                    for (const event of (json.events || [])) {
                        allMatches.push(normalizeCricketScoreboardEvent(event, series));
                    }
                }
            } catch (err) {
                console.error(`   ⚠️ Failed cricket series ${series.id} sweep:`, err.message);
            }
        }

        // Multi-day Tests appear on every one of their calendar days - dedupe the batch
        // so the upsert isn't hammered with identical rows
        const seen = new Set();
        const deduped = allMatches.filter((m) => !seen.has(m.external_id) && seen.add(m.external_id));
        await postMatchesBatch(deduped, 'Cricket fixtures');
    } catch (err) {
        console.error('   ⚠️ Failed cricket fixtures sweep:', err.message);
    }
    console.log('🏁 Cricket fixtures sweep complete!');
}

async function runCricketCycle() {
    console.log('🏏 Starting cricket live scores cycle...');
    try {
        const matches = await fetchCricket();
        await postMatchesBatch(matches, 'Cricket');
    } catch (err) {
        console.error('   ⚠️ Failed to fetch cricket:', err.message);
    }
    console.log('🏁 Cricket live scores cycle complete!');
}

// Run everything once immediately on startup, then on their own cadences: ESPN's live
// cycle every minute (no visible quota, but still a good-citizen interval against an
// undocumented endpoint), the fixtures sweep hourly at :07 (offset so it never lands on
// the same tick as a live cycle - fixtures barely change hour to hour), cricket every
// 5 minutes (also ESPN now, so no daily quota - but one whole-sport feed doesn't need
// minute-level freshness; keep the frontend's cricket staleness leash above this).
runEspnCycle();
runEspnFixturesCycle();
runCricketCycle();
runCricketFixturesCycle();
cron.schedule('* * * * *', runEspnCycle);
cron.schedule('7 * * * *', runEspnFixturesCycle);
cron.schedule('*/5 * * * *', runCricketCycle);
// Offset from the team-sport fixtures sweep so the two never stack on one tick
cron.schedule('23 * * * *', runCricketFixturesCycle);
