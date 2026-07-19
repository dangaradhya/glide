// server/espnLeagues.js
//
// The league_id -> ESPN (sport, slug) mapping, shared between the ingestion cycles
// (liveScores.js) and the box-score summary route (index.js). Lives in its own
// side-effect-free module because requiring liveScores.js starts its cron cycles -
// index.js can't pull the map from there without also kicking off ingestion at
// require time, before the server has finished binding.
//
// Tennis has two tours (ATP/WTA) mapped onto the SAME 'atp' league_id, since Match
// Center only has one generic "Tennis" card today, not separate ATP/WTA cards.
// All slugs were verified live against the real endpoint (each returns the correctly
// named league object, e.g. 'ita.1' -> "Italian Serie A") - not guessed, since a
// wrong slug silently returns an empty or wrong-league response rather than an error.
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
    { league_id: 'mls', sport: 'soccer', slug: 'usa.1' },
    { league_id: 'championship', sport: 'soccer', slug: 'eng.2' },
    { league_id: 'nba', sport: 'basketball', slug: 'nba' },
    { league_id: 'wnba', sport: 'basketball', slug: 'wnba' },
    { league_id: 'mlb', sport: 'baseball', slug: 'mlb' },
    { league_id: 'nfl', sport: 'football', slug: 'nfl' },
    { league_id: 'nhl', sport: 'hockey', slug: 'nhl' },
    { league_id: 'atp', sport: 'tennis', slug: 'atp' },
    { league_id: 'atp', sport: 'tennis', slug: 'wta' },
    { league_id: 'golf', sport: 'golf', slug: 'pga' },
    { league_id: 'golf', sport: 'golf', slug: 'liv' },
    { league_id: 'f1', sport: 'racing', slug: 'f1' },
    { league_id: 'nascar', sport: 'racing', slug: 'nascar-premier' },
    { league_id: 'ufc', sport: 'mma', slug: 'ufc' },
];

module.exports = { ESPN_LEAGUES };
