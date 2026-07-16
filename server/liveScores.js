// server/liveScores.js
//
// Live-score ingestion for Match Center. Mirrors scraper.js's pattern: this file is
// require()'d once from index.js after the server binds, doesn't touch the database
// directly, and instead POSTs normalized results to a scraper-key-authenticated route
// (/api/matches) - same separation the existing posts/reels pipeline uses.
//
// Two vendors, two cadences:
// - ESPN's public scoreboard endpoint (site.api.espn.com) covers football/NBA/MLB/NFL/NHL/
//   Tennis for free with no API key and no visible rate limit, so it's polled every minute -
//   close to real "live" without the 20-minute-per-request-quota math API-Sports forced on us.
//   NOTE: this is an undocumented, unofficial endpoint (the same one espn.com's own frontend
//   calls) - there's no published SLA and it likely isn't authorized for this kind of reuse
//   under ESPN's ToS. Accepted as a known risk for now (flagged in the roadmap); if it ever
//   gets blocked/rate-limited, affected leagues just fall back to the existing outbound-link
//   cards via the staleness check in the frontend (task 5), same as any vendor outage would.
// - CricketData.org has a real per-day quota (100/day free tier), so it stays on the original
//   20-minute cadence.
// F1 and MMA are deliberately excluded - both exist on ESPN too, but neither fits the
// two-teams-with-a-score shape (F1 is a multi-entrant race with a finishing order, MMA is a
// 1-on-1 fight decided by method, not a score) - revisit with a schema that fits them later.
require('dotenv').config();
const cron = require('node-cron');

const PORT = process.env.PORT || 3000;
const MATCHES_API_URL = `http://127.0.0.1:${PORT}/api/matches`;
const CRICKET_DATA_API_KEY = process.env.CRICKET_DATA_API_KEY;

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
    };
}

// Tennis' scoreboard shape is structurally different from every team sport: an "event" here
// is a whole TOURNAMENT (e.g. "Nordea Open"), and the individual matches are nested inside
// event.groupings[] (one grouping per draw - Women's Singles, Men's Singles, etc.), each with
// its own competitions[] array. Competitors use `.athlete.displayName` instead of
// `.team.displayName`, and there's no single score number - `linescores` is a per-set array
// (e.g. two sets, 6-2 6-2), which score_summary joins into "6-2, 6-2" the same way cricket's
// per-innings score gets flattened into a display string.
function normalizeEspnTennisMatch(match, league_id) {
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
        return events.flatMap((event) =>
            (event.groupings || []).flatMap((grouping) =>
                (grouping.competitions || []).map((match) => normalizeEspnTennisMatch(match, league_id))
            )
        );
    }

    return events.map((event) => normalizeEspnEvent(event, league_id));
}

// CricketData.org's shape is messier than ESPN's: `status` is a free-text result sentence
// (e.g. "West Indies Women won by 6 wkts"), not a clean code, so match state is derived from
// the matchStarted/matchEnded booleans instead. `score` is an array of per-innings {r,w,o}
// objects (Test matches can have up to 4 innings), so it doesn't reduce to two integers -
// home_score/away_score stay null and score_summary carries the display line.
async function fetchCricket() {
    const url = `https://api.cricapi.com/v1/currentMatches?apikey=${CRICKET_DATA_API_KEY}&offset=0`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.status !== 'success') {
        console.error('   ⚠️ CricketData.org returned an error:', JSON.stringify(json.info || json.status));
        return [];
    }

    return (json.data || []).map((match) => {
        let status = 'scheduled';
        if (match.matchEnded) status = 'final';
        else if (match.matchStarted) status = 'live';

        const scoreSummary = (match.score || [])
            .map((inn) => `${inn.r}/${inn.w}`)
            .join(', ') || null;

        return {
            league_id: 'cricket',
            vendor: 'cricketdata',
            external_id: match.id,
            home_team: match.teams?.[0] || null,
            away_team: match.teams?.[1] || null,
            home_score: null,
            away_score: null,
            score_summary: scoreSummary,
            status,
            start_time: match.dateTimeGMT || match.date || null,
            clock: null,
        };
    });
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
// 20 minutes (CricketData.org's free tier has a hard 100 requests/day cap).
runEspnCycle();
runEspnFixturesCycle();
runCricketCycle();
cron.schedule('* * * * *', runEspnCycle);
cron.schedule('7 * * * *', runEspnFixturesCycle);
cron.schedule('*/20 * * * *', runCricketCycle);
