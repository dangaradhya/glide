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

// Every league ESPN covers for us. Tennis has two tours (ATP/WTA) mapped onto the SAME
// 'atp' league_id, since Match Center only has one generic "Tennis" card today, not separate
// ATP/WTA cards - both tours' matches show up on that one card.
// All slugs below were verified live against the real endpoint (each returns the correctly
// named league object, e.g. 'ita.1' -> "Italian Serie A") - not guessed, since a wrong slug
// silently returns either an empty or wrong-league response rather than an error.
const ESPN_LEAGUES = [
    { league_id: 'premier_league', sport: 'soccer', slug: 'eng.1' },
    { league_id: 'serie_a', sport: 'soccer', slug: 'ita.1' },
    { league_id: 'la_liga', sport: 'soccer', slug: 'esp.1' },
    { league_id: 'bundesliga', sport: 'soccer', slug: 'ger.1' },
    { league_id: 'ligue_1', sport: 'soccer', slug: 'fra.1' },
    { league_id: 'champions_league', sport: 'soccer', slug: 'uefa.champions' },
    { league_id: 'europa_league', sport: 'soccer', slug: 'uefa.europa' },
    { league_id: 'conference_league', sport: 'soccer', slug: 'uefa.europa.conf' },
    { league_id: 'world_cup', sport: 'soccer', slug: 'fifa.world' },
    { league_id: 'euros', sport: 'soccer', slug: 'uefa.euro' },
    { league_id: 'copa_america', sport: 'soccer', slug: 'conmebol.america' },
    { league_id: 'nations_league', sport: 'soccer', slug: 'uefa.nations' },
    { league_id: 'nba', sport: 'basketball', slug: 'nba' },
    { league_id: 'mlb', sport: 'baseball', slug: 'mlb' },
    { league_id: 'nfl', sport: 'football', slug: 'nfl' },
    { league_id: 'nhl', sport: 'hockey', slug: 'nhl' },
    { league_id: 'atp', sport: 'tennis', slug: 'atp' },
    { league_id: 'atp', sport: 'tennis', slug: 'wta' },
];

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
        home_score: null,
        away_score: null,
        score_summary: setScores.length > 0 ? setScores.join(', ') : null,
        status,
        start_time: match.date,
        clock: status === 'live' ? match.status.type.shortDetail : null,
    };
}

async function fetchEspnLeague({ league_id, sport, slug }) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${slug}/scoreboard`;
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

// Run both once immediately on startup, then on their own cadences: ESPN every minute (no
// visible quota, but still a good-citizen interval against an undocumented endpoint), cricket
// every 20 minutes (CricketData.org's free tier has a hard 100 requests/day cap).
runEspnCycle();
runCricketCycle();
cron.schedule('* * * * *', runEspnCycle);
cron.schedule('*/20 * * * *', runCricketCycle);
