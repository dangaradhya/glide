// INITIALIZE SENTRY FIRST (Always at the top of your main file, before any other imports or code)
const Sentry = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");

Sentry.init({
  dsn: "https://681d851d0b2e9913f9352955f6e54b25@o4511583806554112.ingest.us.sentry.io/4511583831261184",
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: 1.0, 
  profilesSampleRate: 1.0,
});

// 1. IMPORTS (The equivalent of #include in C++ or 'use' in Rust)
// 'require' is how Node.js pulls in external libraries from your node_modules folder.
require('dotenv').config(); // Loads your GOOGLE_CLIENT_ID from the .env file
const express = require('express');
const sqlite3 = require('sqlite3').verbose(); // verbose() gives us detailed error stack traces
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');
const { ESPN_LEAGUES } = require('./espnLeagues'); // league_id -> ESPN (sport, slug), for the box-score summary route
const { uploadProfilePicture } = require('./r2'); // R2 object storage for self-uploaded profile pictures (see Phase 4a)

// 2. INITIALIZATION
// This creates our application instance. Think of this like initializing your Axum router in Rust.
const app = express();
// The port our server will listen on
const PORT = process.env.PORT || 3000; 

// Pulled strictly from .env for security (no fallback)
const JWT_SECRET = process.env.JWT_SECRET;

// For Google Sign-In, we need to set up the OAuth2 client with our Google Client ID.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// This is the Services ID you generate in the Apple Developer Portal (e.g., com.glidesports.app.services)
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID; 

// 3. MIDDLEWARE
// Middleware are functions that intercept incoming HTTP requests before they hit your routes.
// Secure CORS policy restricting access to specific frontend domains
const allowedOrigins = [
    'http://localhost:3000',          // Local development
    'https://glidesports.app',        // Live web app
    'https://www.glidesports.app',    // Backup redirect
    'capacitor://localhost',          // iOS native app
    'https://localhost',              // Android native app (Secure default)
    'http://localhost',               // Android native app (Legacy backup)
    'https://appleid.apple.com'       // Apple Sign-In callback
];
app.use(cors({ origin: allowedOrigins })); 
// express.json() parses incoming JSON payloads (like when we POST new data). 
// Without this, the body of an incoming request would just be raw bytes.
app.use(express.json({ limit: '10mb' }));

// Apple sends authentication payloads from web browsers as form-urlencoded data.
// This middleware allows Express to decode those incoming bytes into req.body.
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// THE SCRAPER BOUNCER
// This middleware blocks anyone from posting fake news to your database by requiring a secret API key.
const verifyScraper = (req, res, next) => {
    // Check the 'x-scraper-key' header in the incoming request. This is a custom header that your scraper will include with 
    // every request to prove it's legit.
    const key = req.headers['x-scraper-key'];
    if (key !== process.env.SCRAPER_KEY) {
        return res.status(403).json({ error: 'Forbidden: Invalid Scraper Key' });
    }
    next();
};

// --- THE AUTHENTICATION BOUNCER ---
// This middleware function checks the headers of incoming requests. 
// If the user doesn't have a valid JWT token, it blocks them from liking/sharing.
const authenticateToken = (req, res, next) => {

    // Get the Authorization header from the incoming request. This is where the frontend should send the JWT token after logging in.
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN_STRING"

    // If there's no token, we return a 401 Unauthorized status with a message. This means the user needs to log in first.
    if (!token) return res.status(401).json({ error: 'Access denied. Please log in.' });

    // In case the user has a token
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
        req.user = user; // Attach the verified user data (like user.id) to the request
        next(); // Let them through to the actual route
    });
};

// 4. DATABASE CONNECTION
// We are creating a connection pool to a local SQLite file. 
// If 'glide.sqlite' doesn't exist, SQLite will create it automatically.
const db = new sqlite3.Database('./data/glide.sqlite', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        
        // TABLE 1: Posts (Articles)
        // Once connected, we execute a SQL command to ensure our schema exists.
        // Added the 'url' column as UNIQUE to prevent duplicate AI processing.
        db.run(`
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sport_category TEXT,
                headline TEXT,
                content TEXT,
                excitement_level INTEGER,
                url TEXT UNIQUE,
                image_url TEXT,
                likes INTEGER DEFAULT 0, 
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) console.error('Error creating table:', err.message);
            else console.log('Posts table ready.');
        });

        // Table 2: Users (Authentication - upgraded for Google OAuth)
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                google_id TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                name TEXT,
                picture TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) console.error('Error creating users table:', err.message);
            else console.log('Users table ready.');
        });

        // TABLE 3: Reels (Videos)
        db.run(`
            CREATE TABLE IF NOT EXISTS reels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id TEXT UNIQUE NOT NULL, 
                title TEXT,
                channel_name TEXT,
                likes INTEGER DEFAULT 0,
                shares INTEGER DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) console.error('Error creating reels table:', err.message);
            else console.log('Reels table ready.');
        });

        // THE JUNCTION TABLES (Guaranteeing 1 like per user)
        db.run(`CREATE TABLE IF NOT EXISTS post_likes (
            post_id INTEGER,
            user_id INTEGER,
            PRIMARY KEY (post_id, user_id)
            )
        `, (err) => {
            if (err) console.error('Error creating post_likes table:', err.message);
            else console.log('post_likes table ready.');
        });

        db.run(`CREATE TABLE IF NOT EXISTS reel_likes (
            reel_id INTEGER,
            user_id INTEGER,
            PRIMARY KEY (reel_id, user_id)
            )
        `, (err) => {
            if (err) console.error('Error creating reel_likes table:', err.message);
            else console.log('reel_likes table ready.');

        });

        // THE JUNCTION TABLES FOR BOOKMARKS
        db.run(`CREATE TABLE IF NOT EXISTS saved_posts (
            post_id INTEGER,
            user_id INTEGER,
            PRIMARY KEY (post_id, user_id)
            )
        `, (err) => {
            if (err) console.error('Error creating saved_posts table:', err.message);
            else console.log('saved_posts table ready.');
        });

        db.run(`CREATE TABLE IF NOT EXISTS saved_reels (
            reel_id INTEGER,
            user_id INTEGER,
            PRIMARY KEY (reel_id, user_id)
            )
        `, (err) => {
            if (err) console.error('Error creating saved_reels table:', err.message);
            else console.log('saved_reels table ready.');
        });

        // USER PREFERENCES TABLE (For personalization features)
        db.run(`
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id INTEGER,
                league_id TEXT, 
                PRIMARY KEY (user_id, league_id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        `, (err) => {
            if (err) console.error('Error creating user_preferences table:', err.message);
            else console.log('User preferences table ready.');
        });

        // COMMENTS TABLE (For the new Fan Zone feature)
        db.run(`
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER,
                user_id INTEGER,
                text TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(post_id) REFERENCES posts(id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        `, (err) => {
            if (err) console.error('Error creating comments table:', err.message);
            else console.log('Comments table ready.');
        });

        // COMMENTS FOR REELS
        db.run(`
            CREATE TABLE IF NOT EXISTS reel_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reel_id INTEGER,
                user_id INTEGER,
                text TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(reel_id) REFERENCES reels(id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        `, (err) => {
            if (err) console.error('Error creating reel_comments table:', err.message);
            else console.log('Reel Comments table ready.');
        });

        // MATCHES TABLE (Match Center live scores - fed by server/liveScores.js ingestion)
        // Status is always normalized to 'scheduled'/'live'/'final' at ingestion time, never a
        // vendor's raw status text, so every consumer (routes, frontend) works off one vocabulary
        // regardless of which vendor a given league is sourced from.
        // score_summary is a human-readable fallback (e.g. cricket's multi-innings "241/7, 242/4")
        // for sports whose score doesn't reduce to two integers; home_score/away_score stay NULL there.
        db.run(`
            CREATE TABLE IF NOT EXISTS matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                league_id TEXT NOT NULL,
                vendor TEXT NOT NULL,
                external_id TEXT NOT NULL,
                home_team TEXT,
                away_team TEXT,
                home_score INTEGER,
                away_score INTEGER,
                score_summary TEXT,
                status TEXT NOT NULL DEFAULT 'scheduled',
                start_time DATETIME,
                clock TEXT,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(vendor, external_id)
            )
        `, (err) => {
            if (err) {
                console.error('Error creating matches table:', err.message);
                return;
            }
            console.log('Matches table ready.');

            // Nested inside the table's own callback (rather than a sibling db.run call) since
            // this codebase doesn't use db.serialize() - two independent db.run calls aren't
            // guaranteed to execute in call order, so an index created as a sibling call can
            // fire before the table it depends on actually exists.
            db.run(`CREATE INDEX IF NOT EXISTS idx_matches_league_status ON matches(league_id, status)`, (idxErr) => {
                if (idxErr) console.error('Error creating matches league/status index:', idxErr.message);
            });

            // Team logo URLs (from ESPN's own CDN), added after the table first shipped.
            // SQLite has no ADD COLUMN IF NOT EXISTS, so the "duplicate column name" error
            // on every boot after the first is expected and swallowed - any OTHER error is
            // still surfaced. Additive-only, per the schema-change PR checklist.
            // tournament (added with Match Center v3): tennis stores "Tournament · Draw"
            // (e.g. "Nordea Open · Women's Singles" - also how men's/women's draws get
            // separated in the UI) and cricket stores the series name; team sports leave
            // it NULL since the league card itself already names the competition.
            for (const col of ['home_logo', 'away_logo', 'tournament']) {
                db.run(`ALTER TABLE matches ADD COLUMN ${col} TEXT`, (alterErr) => {
                    if (alterErr && !alterErr.message.includes('duplicate column name')) {
                        console.error(`Error adding matches.${col}:`, alterErr.message);
                    }
                });
            }

            // One-time category unification ("Soccer" rows predate the fixed scraper
            // vocabulary; "Football" now unambiguously means soccer, matching Match
            // Center). Idempotent, so safe to run every boot - it stops matching rows
            // as soon as the old labels age out of the 7-day posts window.
            db.run(`UPDATE posts SET sport_category = 'Football' WHERE sport_category = 'Soccer'`, function(err) {
                if (err) console.error("Error normalizing Soccer categories:", err.message);
                else if (this.changes > 0) console.log(`🏷️ Normalized ${this.changes} 'Soccer' post(s) to 'Football'`);
            });

            // One-time vendor cleanup (Match Center v3): cricket moved from CricketData.org
            // to ESPN, and leftover cricketdata rows would render as duplicates next to the
            // fresh ESPN rows for the same matches. Idempotent - matches no rows once gone.
            db.run(`DELETE FROM matches WHERE vendor = 'cricketdata'`, function(err) {
                if (err) console.error("Error removing cricketdata rows:", err.message);
                else if (this.changes > 0) console.log(`🏏 Removed ${this.changes} retired cricketdata match row(s)`);
            });
        });

        // Create the FTS5 Virtual Table for Global Search
        db.run(`
            CREATE VIRTUAL TABLE IF NOT EXISTS global_search USING fts5(
                doc_type,       -- 'POST' or 'REEL'
                doc_id UNINDEXED, -- The original table ID (not searched, just returned)
                title,          -- The headline or reel title
                content,        -- The post summary or channel name
                image_url UNINDEXED,
                url UNINDEXED
            )
        `, (err) => {
            if (err) console.error('Error creating FTS5 search table:', err.message);
            else {
                console.log('FTS5 Global Search table ready.');
                
                // Backfill existing posts if they aren't in the search index yet
                db.run(`INSERT INTO global_search (doc_type, doc_id, title, content, image_url, url)
                        SELECT 'POST', id, headline, content, image_url, url 
                        FROM posts 
                        WHERE id NOT IN (SELECT doc_id FROM global_search WHERE doc_type = 'POST')`);
                
                // Backfill existing reels
                db.run(`INSERT INTO global_search (doc_type, doc_id, title, content)
                        SELECT 'REEL', id, title, channel_name 
                        FROM reels 
                        WHERE id NOT IN (SELECT doc_id FROM global_search WHERE doc_type = 'REEL')`);
            }
        });

        // Create Database Triggers to auto-sync new data into the search engine
        db.run(`
            CREATE TRIGGER IF NOT EXISTS after_post_insert AFTER INSERT ON posts BEGIN
                INSERT INTO global_search(doc_type, doc_id, title, content, image_url, url)
                VALUES ('POST', new.id, new.headline, new.content, new.image_url, new.url);
            END;
        `);

        db.run(`
            CREATE TRIGGER IF NOT EXISTS after_reel_insert AFTER INSERT ON reels BEGIN
                INSERT INTO global_search(doc_type, doc_id, title, content)
                VALUES ('REEL', new.id, new.title, new.channel_name);
            END;
        `);
    }
});

// 5. GOOGLE AUTHENTICATION ROUTE
// Big Picture: This is the route that handles Google Sign-In. When a user clicks "Sign in with Google" on the frontend, 
// it sends the Google ID token to this endpoint. We verify the token with Google's servers, extract the user's info, and 
// then either create a new user in our database or find the existing one. Finally, we generate a JWT token for our app and 
// send it back to the frontend so they can authenticate future requests.
app.post('/api/auth/google', async (req, res) => {
    // The frontend should send a JSON payload with the Google ID token they received after the user signed in with Google.
    const { token } = req.body;

    try {
        // Ask Google to verify the token sent from the frontend
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: GOOGLE_CLIENT_ID, 
        });
        
        // Extract the user's data from the verified payload
        const payload = ticket.getPayload();
        const { sub: google_id, email, name, picture } = payload;

        // Try to find the user by their Google ID
        db.get(`SELECT id, name, picture FROM users WHERE google_id = ?`, [google_id], (err, userByGoogle) => {
            if (err) return res.status(500).json({ error: 'Database error' });

            if (userByGoogle) {
                // Standard returning Google user
                const glideToken = jwt.sign({ userId: userByGoogle.id, email: email }, JWT_SECRET, { expiresIn: '90d' });
                return res.status(200).json({ token: glideToken, user: { id: userByGoogle.id, name: userByGoogle.name, picture: userByGoogle.picture } });
            } else {
                // Check if they previously signed up with Apple using this exact email
                db.get(`SELECT id, name, picture FROM users WHERE email = ?`, [email], (err, userByEmail) => {
                    if (userByEmail) {
                        // Email exists! Safely link the session and log them in smoothly.
                        const glideToken = jwt.sign({ userId: userByEmail.id, email: email }, JWT_SECRET, { expiresIn: '90d' });
                        return res.status(200).json({ token: glideToken, user: { id: userByEmail.id, name: userByEmail.name, picture: userByEmail.picture } });
                    } else {
                        // Truly new user! Safe to insert.
                        db.run(`INSERT INTO users (google_id, email, name, picture) VALUES (?, ?, ?, ?)`, 
                        [google_id, email, name, picture], function(insertErr) {
                            if (insertErr) return res.status(500).json({ error: 'Failed to create user' });
                            
                            const glideToken = jwt.sign({ userId: this.lastID, email: email }, JWT_SECRET, { expiresIn: '90d' });
                            res.status(201).json({ token: glideToken, user: { id: this.lastID, name, picture } });
                        });
                    }
                });
            }
        });
    } catch (error) {
        console.error("Google Auth Error:", error);
        res.status(401).json({ error: 'Invalid Google token' });
    }
});

// APPLE AUTHENTICATION ROUTE
// This route handles Apple Sign-In. Similar to Google, we verify the Apple ID token, extract user info, and manage user records in our database.
app.post('/api/auth/apple', async (req, res) => {
    // The frontend should send a JSON payload with the Apple ID token and optionally the user's name.
    const token = req.body.token || req.body.id_token;
    const incomingName = req.body.name || req.body.user;

    // If the token is missing, we return a 400 Bad Request status with an error message.
    if (!token) {
        return res.status(400).json({ error: 'Missing secure identity token payload.' });
    }

    try {
        // Verify the Apple ID token using the apple-signin-auth library. We specify the expected audience (our Apple Client ID) and ignore expiration for testing purposes.
        const payload = await appleSignin.verifyIdToken(token, {
            audience: [APPLE_CLIENT_ID, 'com.glidesports.glide'], 
            ignoreExpiration: true,
        });
        
        // Extract the unique Apple user ID (sub) and email from the payload. If the email is missing (Apple can hide it), we create a safe fallback
        // email using Apple's private relay domain. Also, we create a unified provider ID that combines "apple_" with the unique Apple user ID for consistent database storage.
        const { sub: apple_sub, email } = payload;
        const safeEmail = email || `${apple_sub}@privaterelay.appleid.com`;
        const unifiedProviderId = `apple_${apple_sub}`;
        
        let parsedName = "";
        if (incomingName) {
            try {
                // Apple sends the name as a JSON string, so we parse it. If it's already an object, we use it directly.
                const profileObj = typeof incomingName === 'string' ? JSON.parse(incomingName) : incomingName;
                if (profileObj.name && profileObj.name.firstName) {
                    parsedName = `${profileObj.name.firstName} ${profileObj.name.lastName || ''}`.trim();
                } else if (profileObj.firstName) {
                    parsedName = `${profileObj.firstName} ${profileObj.lastName || ''}`.trim();
                }
            } catch (e) {
                if (typeof incomingName === 'string') parsedName = incomingName;
            }
        }
        
        // If we couldn't parse a name from the Apple payload, we fall back to using the part of the email before the '@' symbol. 
        // This ensures we always have a display name for the user.
        const finalName = parsedName || safeEmail.split('@')[0];
        const defaultPicture = `https://ui-avatars.com/api/?name=${encodeURIComponent(finalName)}&background=random`;

        db.get(`SELECT id, name, picture FROM users WHERE google_id = ?`, [unifiedProviderId], (err, userByApple) => {
            if (err) return res.status(500).send("Database error");

            // We determine the target origin for the redirect after successful authentication. By default, we send them to the live 
            // web app, but if the request came from localhost or the backup domain, we respect that.
            let targetOrigin = 'https://glidesports.app';
            if (req.body.state === 'http://localhost:3000' || req.body.state === 'https://www.glidesports.app') {
                targetOrigin = req.body.state;
            }

            if (userByApple) {
                // If the user already exists in our DB, we DO NOT CARE what Apple sent. 
                // We strictly return the name and picture currently saved in our database.
                const glideToken = jwt.sign({ userId: userByApple.id, email: safeEmail }, JWT_SECRET, { expiresIn: '90d' });
                const userData = { id: userByApple.id, name: userByApple.name, picture: userByApple.picture };
                return res.redirect(`${targetOrigin}/?token=${glideToken}&user=${encodeURIComponent(JSON.stringify(userData))}`);
            } else {
                // If we didn't find a user with this Apple ID, we check if there's a user with the same email. This handles the case where a user previously 
                // signed up with Google and is now signing in with Apple using the same email.
                db.get(`SELECT id, name, picture FROM users WHERE email = ?`, [safeEmail], (err, userByEmail) => {
                    if (userByEmail) {
                        // User previously signed up with Google! Let them in smoothly.
                        const glideToken = jwt.sign({ userId: userByEmail.id, email: safeEmail }, JWT_SECRET, { expiresIn: '90d' });
                        const userData = { id: userByEmail.id, name: userByEmail.name, picture: userByEmail.picture };
                        return res.redirect(`${targetOrigin}/?token=${glideToken}&user=${encodeURIComponent(JSON.stringify(userData))}`);
                    } else {
                        // Truly new Apple user! Safe to insert finalName and defaultPicture.
                        db.run(`INSERT INTO users (google_id, email, name, picture) VALUES (?, ?, ?, ?)`, 
                        [unifiedProviderId, safeEmail, finalName, defaultPicture], function(insertErr) {
                            if (insertErr) return res.status(500).send("Failed to create user");
                            
                            // After creating the new user, we generate a JWT token for them and redirect back to the frontend with their token and user data.
                            const glideToken = jwt.sign({ userId: this.lastID, email: safeEmail }, JWT_SECRET, { expiresIn: '90d' });
                            const userData = { id: this.lastID, name: finalName, picture: defaultPicture };
                            return res.redirect(`${targetOrigin}/?token=${glideToken}&user=${encodeURIComponent(JSON.stringify(userData))}`);
                        });
                    }
                });
            }
        });
    } catch (error) {
        console.error("Apple Auth Error:", error);
        res.status(401).json({ error: 'Invalid Apple token' });
    }
});

// 6. ROUTING (The API Endpoints)
// When a client visits https://glide-sports.onrender.com/api/health it fires this callback function. 
// 'req' is the incoming request, 'res' is the outgoing response.
app.get('/api/health', (req, res) => {
    // We send back a standard HTTP 200 OK status with a JSON payload.
    res.status(200).json({ status: 'Online', message: 'Glide API is running' });
});

// 7. Global Search Endpoint using SQLite FTS5 MATCH
// This route allows the frontend to perform a global search across both posts and reels using SQLite's full-text search capabilities.

// --- Typo-tolerance support ---
// FTS5's prefix match can't recover from a typo ("Lebrn*" matches nothing, since no
// indexed word STARTS with it). When a query comes back empty, we retry it with each
// word snapped to its closest indexed word by edit distance. The vocabulary comes from
// the search index itself, which the 7-day retention policy keeps small (a few hundred
// rows), and is rebuilt at most every 5 minutes.
const SEARCH_VOCAB_TTL_MS = 5 * 60 * 1000;
let searchVocabCache = { builtAt: 0, words: [] };

function levenshtein(a, b) {
    // Single-row dynamic programming - a and b are short single words here
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        for (let j = 1; j <= b.length; j++) {
            curr[j] = Math.min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
        prev = curr;
    }
    return prev[b.length];
}

function getSearchVocabulary(callback) {
    if (Date.now() - searchVocabCache.builtAt < SEARCH_VOCAB_TTL_MS) {
        return callback(searchVocabCache.words);
    }
    db.all(`SELECT title, content FROM global_search`, (err, rows) => {
        if (err) return callback(searchVocabCache.words); // stale beats broken
        const words = new Set();
        for (const row of rows || []) {
            for (const word of `${row.title || ''} ${row.content || ''}`.toLowerCase().split(/[^a-z0-9']+/)) {
                if (word.length >= 3) words.add(word);
            }
        }
        searchVocabCache = { builtAt: Date.now(), words: [...words] };
        callback(searchVocabCache.words);
    });
}

// Snap each query word (3+ chars) to its closest vocabulary word within edit
// distance 2. Returns null when nothing needed correcting or nothing was close
// enough - i.e. when a retry would just repeat the original query.
function correctQuery(query, vocab) {
    const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);
    let anyCorrected = false;

    const corrected = queryWords.map((word) => {
        if (word.length < 3) return word;
        let best = null;
        let bestDistance = Math.min(2, Math.floor(word.length / 2));
        for (const candidate of vocab) {
            // Cheap length pre-filter before the O(n*m) distance
            if (Math.abs(candidate.length - word.length) > bestDistance) continue;
            if (candidate === word) return word; // already a real word, leave it
            const distance = levenshtein(word, candidate);
            if (distance <= bestDistance && distance > 0) {
                best = candidate;
                bestDistance = distance - 1; // only accept strictly better after this
                if (bestDistance < 0) break;
            }
        }
        if (best) anyCorrected = true;
        return best || word;
    });

    return anyCorrected ? corrected.join(' ') : null;
}

// Optional ?type=POST|REEL scopes results to one facet ("just reels"), so a facet
// returns a full page of its own kind instead of the client filtering a mixed list.
// Optional ?v=2 switches the response to { results, correctedQuery } - opt-in so
// already-open older clients (expecting a bare array) keep working across deploys.
app.get('/api/search', (req, res) => {
    const query = req.query.q;
    const wantsV2 = req.query.v === '2';
    const docType = ['POST', 'REEL'].includes(req.query.type) ? req.query.type : null;
    const send = (rows, correctedQuery) =>
        res.status(200).json(wantsV2 ? { results: rows, correctedQuery: correctedQuery || null } : rows);

    // If the search bar is empty, return an empty result
    if (!query || query.trim() === '') return send([]);

    // Added LEFT JOIN to fetch the specific video_id for Reel routing
    const sql = `
        SELECT global_search.*, reels.video_id
        FROM global_search
        LEFT JOIN reels ON global_search.doc_type = 'REEL' AND global_search.doc_id = reels.id
        WHERE global_search MATCH ?
        ${docType ? `AND doc_type = ?` : ''}
        ORDER BY rank
        LIMIT 8
    `;
    const paramsFor = (matchQuery) => (docType ? [matchQuery, docType] : [matchQuery]);

    // We append a wildcard '*' to the user's query for "prefix matching"
    // e.g., typing "Lebr" will instantly match "Lebron"
    // We also remove double quotes to prevent SQL syntax errors in the MATCH clause
    const cleaned = query.replace(/"/g, '');
    const safeQuery = cleaned + '*';

    // We execute the search query against the global_search virtual table. If there's an error, we log it and return a 500 status.
    db.all(sql, paramsFor(safeQuery), (err, rows) => {
        if (err) {
            console.error("Search error:", err.message);
            return res.status(500).json({ error: 'Search engine failure' });
        }
        if (rows.length > 0 || cleaned.trim().length < 3) return send(rows);

        // Zero hits: one typo-corrected retry before giving up
        getSearchVocabulary((vocab) => {
            const correctedQuery = correctQuery(cleaned.trim(), vocab);
            if (!correctedQuery) return send([]);

            db.all(sql, paramsFor(correctedQuery + '*'), (retryErr, retryRows) => {
                if (retryErr || !retryRows || retryRows.length === 0) return send([]);
                send(retryRows, correctedQuery);
            });
        });
    });
});

// THE DEDUPLICATION CHECKER ROUTE (The Gatekeeper)
// The scraper hits this route first to see if a URL already exists in the database.
// Added verifyScraper middleware to protect this route
app.post('/api/posts/check', verifyScraper, (req, res) => {
    const { url } = req.body;
    // We query the database to see if any post already has this URL. If it does, we return { exists: true }.
    // {exists:!!row} is a common JavaScript trick to convert a row object into a boolean (true if it exists, false if null).
    db.get(`SELECT id FROM posts WHERE url = ?`, [url], (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ exists: !!row }); // Returns true if the URL is already in the DB
    });
});

// 8. CREATING DATA (The POST Route - the 'write' operation)
// Big Picture: The post route is where the scraper or AI agent will send new sports news to be saved in the database.
// When your scraper grabs a new article from the web and Gemini formats it, the scraper needs a way to hand that 
// data over to the database. It packages the data into a JSON payload and sends it via a POST request.
// Added verifyScraper middleware to protect this route
// Categories stay deliberately granular (NFL, NBA, WNBA, MLB, ... - better pills than
// broad sport names), with exactly ONE pinned rule enforced in the scraper prompt:
// "Football" means soccer, and "Soccer" is never a label. This map is the safety net
// for the one synonym the AI is known to slip on.
const CATEGORY_SYNONYMS = {
    'Soccer': 'Football',
};

app.post('/api/posts', verifyScraper, (req, res) => {
    let { sport_category, headline, content, excitement_level, url, image_url } = req.body;

    // Basic validation: Check if the request is missing any data.
    if (!sport_category || !headline || !content || !excitement_level || !url) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    sport_category = CATEGORY_SYNONYMS[sport_category] || sport_category;

    // The question marks are placeholders for parameterized queries. They help prevent SQL injection attacks by treating the 
    // values as data rather than executable code. When we call db.run, we pass an array of values that correspond to each question
    // mark in the SQL string. The database engine safely substitutes these values into the query, ensuring that any malicious input 
    // is not executed as part of the SQL command.
    const sql = `INSERT INTO posts (sport_category, headline, content, excitement_level, url, image_url) 
                 VALUES (?, ?, ?, ?, ?, ?)`;

    db.run(sql, [sport_category, headline, content, excitement_level, url, image_url], function(err) {
        if (err) {
            console.error("Error inserting data:", err.message);
            return res.status(500).json({ error: 'Failed to save post to database' });
        }
        res.status(201).json({ message: 'Glide post created successfully!', postId: this.lastID });
    });
});

// Maps each Match Center league_id to the sport_category value(s) our AI-rewrite pipeline
// actually uses for that sport, so a user's explicit league picks can boost matching posts
// in their feed. Built from real observed sport_category values in production, not guessed.
// The scraper vocabulary + CATEGORY_SYNONYMS now normalize labels at insert ("Soccer" ->
// "Football" etc.), but the old synonyms stay listed here harmlessly as a belt-and-braces
// match for any stragglers. This is necessarily sport-level, not
// league-level: posts are only ever tagged with a broad sport (e.g. "Football"), never a
// specific league, so picking "Premier League" boosts ALL football posts, not Premier
// League ones specifically - true league-level personalization would need the AI pipeline
// to extract which league an article is about, out of scope here.
const LEAGUE_TO_SPORT_CATEGORIES = {
    nba: ['Basketball', 'WNBA'],
    mlb: ['Baseball'],
    nfl: ['NFL', 'American Football'],
    nhl: ['Hockey', 'Ice Hockey'],
    cricket: ['Cricket'],
    atp: ['Tennis'],
    ufc: ['MMA'],
    f1: ['Formula 1', 'Motorsport'],
    premier_league: ['Football', 'Soccer'],
    serie_a: ['Football', 'Soccer'],
    la_liga: ['Football', 'Soccer'],
    bundesliga: ['Football', 'Soccer'],
    ligue_1: ['Football', 'Soccer'],
    champions_league: ['Football', 'Soccer'],
    europa_league: ['Football', 'Soccer'],
    conference_league: ['Football', 'Soccer'],
    world_cup: ['Football', 'Soccer'],
    euros: ['Football', 'Soccer'],
    copa_america: ['Football', 'Soccer'],
    nations_league: ['Football', 'Soccer'],
};

// 9. READING DATA (The GET Route - 'read operation')
// Big Picture: When a user opens Glide on their phone or laptop, the UI is completely empty.
// The frontend immediately fires off a GET request to your server asking for the latest data to display.
app.get('/api/posts', (req, res) => {
    // Force Cloudflare and mobile browsers to NEVER cache this feed
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');

    // Cursor-based pagination: instead of "skip N, take limit" (which is purely positional
    // and silently skips or duplicates posts if a new one lands between two page fetches -
    // the hourly scraper makes this a real, recurring scenario, not a hypothetical), the
    // client sends back the (timestamp, id) of the last post it saw, and we return
    // everything strictly older than that. The compound key matters because
    // CURRENT_TIMESTAMP only has second-level resolution - two posts could share a
    // timestamp, and id (unique, autoincrement) breaks the tie so no post can ever fall
    // through the gap between two pages.
    const limit = parseInt(req.query.limit) || 20;
    const cursorTimestamp = req.query.cursorTimestamp;
    const cursorId = parseInt(req.query.cursorId);
    const hasCursor = !!cursorTimestamp && !isNaN(cursorId);

    // Authentication Check - We check if the frontend sent a token. If they did,
    // we figure out who they are. This allows us to personalize the feed in the future
    // (e.g., show which posts they've liked).
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    let userId = null;

    // If there's a token, we try to verify it. If it's valid, we extract the user ID from the token's payload.
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            userId = decoded.userId;
        } catch (err) {
            // Ignore expired tokens on the GET request; just treat them as a logged-out guest
        }
    }

    const cursorClause = hasCursor ? `AND (timestamp < ? OR (timestamp = ? AND id < ?))` : '';

    // Runs the actual feed query once we know which sport categories (if any) to boost for
    // this user. Boosting only re-sorts the DISPLAY ORDER within the already
    // cursor-paginated chronological window - it never changes which posts are IN that
    // window, so the pagination-correctness fix above is completely unaffected by it.
    const runFeedQuery = (preferredCategories) => {
        const hasPreferences = preferredCategories.length > 0;
        const boostPlaceholders = hasPreferences ? preferredCategories.map(() => '?').join(',') : '';
        const orderClause = hasPreferences
            ? `(CASE WHEN sport_category IN (${boostPlaceholders}) THEN 0 ELSE 1 END), timestamp DESC, id DESC`
            : `timestamp DESC, id DESC`;

        // Dynamic SQL based on Auth Status
        const innerSql = userId
            ? `SELECT posts.*,
                 EXISTS(SELECT 1 FROM post_likes WHERE post_id = posts.id AND user_id = ?) AS userLiked,
                 EXISTS(SELECT 1 FROM saved_posts WHERE post_id = posts.id AND user_id = ?) AS userSaved,
                 (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) AS commentCount
               FROM posts
               WHERE timestamp >= datetime('now', '-7 days') ${cursorClause}
               ORDER BY timestamp DESC, id DESC LIMIT ?`
            : `SELECT posts.*, 0 AS userLiked, 0 AS userSaved,
                 (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) AS commentCount
               FROM posts
               WHERE timestamp >= datetime('now', '-7 days') ${cursorClause}
               ORDER BY timestamp DESC, id DESC LIMIT ?`;

        // The inner query decides WHICH posts are in this page (pure chronological cursor
        // pagination, untouched by personalization). The outer query only re-sorts the
        // DISPLAY order of that already-fixed set of rows.
        const sql = `SELECT * FROM (${innerSql}) AS windowed ORDER BY ${orderClause}`;

        // The parameters we pass to the database depend on whether we have a userId and/or
        // a cursor. Order matters: userId (x2, for the userLiked/userSaved subqueries)
        // first, then the cursor values (timestamp appears twice - once for the strict
        // "older than" check, once for the same-timestamp tiebreak), then limit - all of
        // that is for the INNER query. The boost category params come last, since the
        // CASE WHEN they belong to is in the OUTER query, textually after the inner one.
        const authParams = userId ? [userId, userId] : [];
        const cursorParams = hasCursor ? [cursorTimestamp, cursorTimestamp, cursorId] : [];
        const boostParams = hasPreferences ? preferredCategories : [];
        const params = [...authParams, ...cursorParams, limit, ...boostParams];

        // Finally, we execute the query. If there's an error, we log it and return a 500 status.
        // If it's successful, we return the rows of posts as JSON.
        db.all(sql, params, (err, rows) => {
            if (err) {
                console.error("Error fetching data:", err.message);
                return res.status(500).json({ error: 'Failed to retrieve feed' });
            }

            // SQLite returns 1 for true and 0 for false. We map it to standard strict booleans for React.
            // We take each row of the result and create a new object that has all the same fields (...row) but overrides 'userLiked' to be a boolean.
            // This way, the frontend can easily check if userLiked is true or false without having to remember that 1 means liked and 0 means not liked.
            // We do the same for 'userSaved' if we want to use that in the frontend as well.
            const formattedRows = rows.map(row => ({
                ...row,
                userLiked: row.userLiked === 1,
                userSaved: row.userSaved === 1
            }));

            // The next-page cursor has to anchor to the CHRONOLOGICALLY oldest post in this
            // batch, not whichever row happens to land last after the preference re-sort
            // above - otherwise personalization would silently break pagination (skipping
            // or repeating posts) the moment it reorders anything.
            const chronologicallyOldest = formattedRows.reduce((oldest, row) => {
                if (!oldest) return row;
                if (row.timestamp < oldest.timestamp) return row;
                if (row.timestamp === oldest.timestamp && row.id < oldest.id) return row;
                return oldest;
            }, null);
            const nextCursor = chronologicallyOldest
                ? { timestamp: chronologicallyOldest.timestamp, id: chronologicallyOldest.id }
                : null;

            res.status(200).json({ posts: formattedRows, nextCursor });
        });
    };

    // Personalization only applies to logged-in users who've saved league preferences in
    // Match Center - guests, and logged-in users with no preferences saved, get the exact
    // same plain chronological feed as before, completely unchanged.
    if (userId) {
        db.all(`SELECT league_id FROM user_preferences WHERE user_id = ?`, [userId], (err, prefRows) => {
            if (err) {
                console.error("Error fetching preferences for personalization:", err.message);
                return runFeedQuery([]);
            }
            const preferredCategories = [...new Set(
                prefRows.flatMap(row => LEAGUE_TO_SPORT_CATEGORIES[row.league_id] || [])
            )];
            runFeedQuery(preferredCategories);
        });
    } else {
        runFeedQuery([]);
    }
});

// 10. SOCIAL INTERACTION ROUTES (Protected by authenticateToken)
// Upgraded Like system to use Junction Tables, securing routes with JWT.

// Toggle Like on a Post
// This route allows a logged-in user to like or unlike a post. It checks if the user has already liked the post by 
// looking up the junction table (post_likes).
app.post('/api/posts/:id/like', authenticateToken, (req, res) => {
    // We extract the post ID from the URL parameters and the user ID from the authenticated JWT token.
    const postId = req.params.id;
    const userId = req.user.userId; 

    // Check if the user already liked this post
    db.get(`SELECT * FROM post_likes WHERE post_id = ? AND user_id = ?`, [postId, userId], (err, row) => {
        // If there's an error with the database query, we return a 500 status with an error message.
        // If the query runs successfully, we check if 'row' exists. If it does, that means the user has already liked the post.
        if (row) {
            // They already liked it. We DELETE the record and decrement the main counter (Unlike)
            db.run(`DELETE FROM post_likes WHERE post_id = ? AND user_id = ?`, [postId, userId], () => {
                db.run(`UPDATE posts SET likes = likes - 1 WHERE id = ?`, [postId]);
                res.json({ liked: false });
            });
        } else {
            // They haven't liked it. INSERT a record and increment the main counter (Like)
            db.run(`INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)`, [postId, userId], () => {
                db.run(`UPDATE posts SET likes = likes + 1 WHERE id = ?`, [postId]);
                res.json({ liked: true });
            });
        }
    });
});

// Toggle Like on a Reel
// This route is essentially the same logic as the post like route, but it operates on reels and uses the reel_likes junction table.
app.post('/api/reels/:id/like', authenticateToken, (req, res) => {
    // We extract the reel ID from the URL parameters and the user ID from the authenticated JWT token, just like with posts.
    const reelId = req.params.id;
    const userId = req.user.userId;

    // We check if the user has already liked this reel by querying the reel_likes junction table. If a record exists, they have liked it.
    db.get(`SELECT * FROM reel_likes WHERE reel_id = ? AND user_id = ?`, [reelId, userId], (err, row) => {
        if (row) {
            // They already liked it. We DELETE the record from the junction table and decrement the likes counter in the reels table (Unlike).
            db.run(`DELETE FROM reel_likes WHERE reel_id = ? AND user_id = ?`, [reelId, userId], () => {
                db.run(`UPDATE reels SET likes = likes - 1 WHERE id = ?`, [reelId]);
                res.json({ liked: false });
            });
        } else {
            // They haven't liked it. We INSERT a new record into the reel_likes junction table and increment the likes counter in the reels table (Like).
            db.run(`INSERT INTO reel_likes (reel_id, user_id) VALUES (?, ?)`, [reelId, userId], () => {
                db.run(`UPDATE reels SET likes = likes + 1 WHERE id = ?`, [reelId]);
                res.json({ liked: true });
            });
        }
    });
});

// Share a Reel
// We don't necessarily need the user to be logged in just to share it with a friend, 
// so this route doesn't have the 'authenticateToken' bouncer.
app.post('/api/reels/:id/share', (req, res) => {
    // When a user clicks the "Share" button on a reel, the frontend will hit this endpoint to record that share in the database.
    const reelId = req.params.id;

    // We simply increment the 'shares' counter for that reel. In a real app, we might also want to log who shared it and when, 
    // but for simplicity, we're just counting total shares.
    db.run(`UPDATE reels SET shares = shares + 1 WHERE id = ?`, [reelId], function(err) {
        if (err) return res.status(500).json({ error: 'Failed to record share' });
        res.json({ success: true, message: 'Share recorded' });
    });
});

// Toggle Save on a Post
// This route allows users to bookmark posts. It checks the saved_posts junction table to see if the user has already saved the post,
app.post('/api/posts/:id/save', authenticateToken, (req, res) => {
    // We extract the post ID from the URL parameters and the user ID from the authenticated JWT token, just like with likes.
    const postId = req.params.id;
    const userId = req.user.userId; 

    // We check if the user has already saved this post by querying the saved_posts junction table. If a record exists, they have saved it.
    db.get(`SELECT * FROM saved_posts WHERE post_id = ? AND user_id = ?`, [postId, userId], (err, row) => {
        if (row) {
            // Un-save it
            db.run(`DELETE FROM saved_posts WHERE post_id = ? AND user_id = ?`, [postId, userId], () => {
                res.json({ saved: false });
            });
        } else {
            // Save it
            db.run(`INSERT INTO saved_posts (post_id, user_id) VALUES (?, ?)`, [postId, userId], () => {
                res.json({ saved: true });
            });
        }
    });
});

// Toggle Save on a Reel
// This route is the same logic as the post save route, but it operates on reels and uses the saved_reels junction table.
app.post('/api/reels/:id/save', authenticateToken, (req, res) => {
    // We extract the reel ID from the URL parameters and the user ID from the authenticated JWT token, just like with posts.
    const reelId = req.params.id;
    const userId = req.user.userId;

    // We check if the user has already saved this reel by querying the saved_reels junction table. If a record exists, they have saved it.
    db.get(`SELECT * FROM saved_reels WHERE reel_id = ? AND user_id = ?`, [reelId, userId], (err, row) => {
        if (row) {
            // Un-save it
            db.run(`DELETE FROM saved_reels WHERE reel_id = ? AND user_id = ?`, [reelId, userId], () => {
                res.json({ saved: false });
            });
        } else {
            // Save it
            db.run(`INSERT INTO saved_reels (reel_id, user_id) VALUES (?, ?)`, [reelId, userId], () => {
                res.json({ saved: true });
            });
        }
    });
});

// 11. COMMENTS ROUTES (The Fan Zone)

// GET route to fetch comments for a specific post. This will be used in the Fan Zone section of the app where users can read and post comments on each news article.
app.get('/api/posts/:id/comments', (req, res) => {
    const postId = req.params.id;
    // We join the users table so we can display their Google avatar and name next to their comment!
    const sql = `
        SELECT comments.*, users.name, users.picture 
        FROM comments 
        JOIN users ON comments.user_id = users.id 
        WHERE post_id = ? 
        ORDER BY timestamp ASC
    `;
    db.all(sql, [postId], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error fetching comments' });
        res.status(200).json(rows);
    });
});

// POST route to submit a new comment on a post. This is also part of the Fan Zone feature, allowing users to engage with each news article by sharing their thoughts.
app.post('/api/posts/:id/comments', authenticateToken, (req, res) => {
    // When a user submits a comment on a post, the frontend will send a POST request to this endpoint with the comment text.
    // We extract the post ID from the URL parameters, the user ID from the authenticated JWT token, and the comment text from the request body.
    const postId = req.params.id;
    const userId = req.user.userId;
    const { text } = req.body;

    if (!text || text.trim() === '') return res.status(400).json({ error: 'Comment cannot be empty' });

    // We insert the new comment into the comments table, associating it with the post ID and user ID. After inserting, we immediately 
    // fetch the newly created comment along with the user's name and picture so we can return it in the response. 
    // This allows the frontend to append the new comment to the list without needing to refresh.
    const sql = `INSERT INTO comments (post_id, user_id, text) VALUES (?, ?, ?)`;
    db.run(sql, [postId, userId, text], function(err) {
        if (err) return res.status(500).json({ error: 'Failed to post comment' });
        
        // Immediately fetch the newly created comment with the user's data so the frontend can append it instantly
        db.get(`
            SELECT comments.*, users.name, users.picture 
            FROM comments 
            JOIN users ON comments.user_id = users.id 
            WHERE comments.id = ?
        `, [this.lastID], (fetchErr, row) => {
            if (fetchErr) return res.status(500).json({ error: 'Failed to retrieve new comment' });
            res.status(201).json(row);
        });
    });
});

// Securely Edit a Comment (15 Minute Window)
app.put('/api/comments/:id', authenticateToken, (req, res) => {
    // This route allows a user to edit their comment, but only within a 15-minute window after posting. We first check if the 
    // comment exists and if the requesting user is the author. Then we check if it's still within the allowed edit time frame 
    // before allowing the update.
    const commentId = req.params.id;
    const userId = req.user.userId;
    const { text } = req.body;

    if (!text || text.trim() === '') return res.status(400).json({ error: 'Comment cannot be empty' });

    // First, we fetch the comment to check ownership and timestamp
    db.get(`SELECT * FROM comments WHERE id = ?`, [commentId], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Comment not found' });
        
        // Security Check 1: Is this the user who wrote it?
        if (row.user_id !== userId) return res.status(403).json({ error: 'Unauthorized to edit this comment' });

        // Security Check 2: Has it been less than 15 minutes?
        // SQLite stores CURRENT_TIMESTAMP in UTC. We append 'Z' to ensure JS parses it correctly.
        const commentTime = new Date(row.timestamp + 'Z').getTime();
        const timeElapsedMinutes = (Date.now() - commentTime) / (1000 * 60);

        if (timeElapsedMinutes > 15) {
            return res.status(403).json({ error: 'The 15-minute edit window has expired.' });
        }

        // If both checks pass, we allow the update to proceed. We use a parameterized query to safely update the comment text.
        db.run(`UPDATE comments SET text = ? WHERE id = ?`, [text, commentId], function(updateErr) {
            if (updateErr) return res.status(500).json({ error: 'Failed to update comment' });
            res.status(200).json({ success: true, text });
        });
    });
});

// Securely Delete a Comment (15 Minute Window)
app.delete('/api/comments/:id', authenticateToken, (req, res) => {
    const commentId = req.params.id;
    const userId = req.user.userId;

    // Similar to the edit route, we first check if the comment exists and if the requesting user is the author. 
    // Then we check if it's still within the allowed deletion time frame before allowing the delete operation.
    db.get(`SELECT * FROM comments WHERE id = ?`, [commentId], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Comment not found' });
        
        if (row.user_id !== userId) return res.status(403).json({ error: 'Unauthorized to delete this comment' });

        const commentTime = new Date(row.timestamp + 'Z').getTime();
        const timeElapsedMinutes = (Date.now() - commentTime) / (1000 * 60);

        if (timeElapsedMinutes > 15) {
            return res.status(403).json({ error: 'The 15-minute deletion window has expired.' });
        }

        // If both checks pass, we allow the delete to proceed. We use a parameterized query to safely delete the comment.
        db.run(`DELETE FROM comments WHERE id = ?`, [commentId], function(delErr) {
            if (delErr) return res.status(500).json({ error: 'Failed to delete comment' });
            
            // Adjust the post comment count downward dynamically
            res.status(200).json({ success: true, postId: row.post_id });
        });
    });
});

// REEL COMMENTS ROUTES
// These 4 endpoints duplicate the exact secure logic of Post Comments, mapped to the reel_comments table.

// GET comments for a reel
app.get('/api/reels/:id/comments', (req, res) => {
    // We join the users table so we can display their Google avatar and name next to their comment!
    const reelId = req.params.id;
    const sql = `
        SELECT reel_comments.*, users.name, users.picture 
        FROM reel_comments 
        JOIN users ON reel_comments.user_id = users.id 
        WHERE reel_id = ? 
        ORDER BY timestamp ASC
    `;
    db.all(sql, [reelId], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error fetching reel comments' });
        res.status(200).json(rows);
    });
});

// POST a new comment on a reel
app.post('/api/reels/:id/comments', authenticateToken, (req, res) => {
    // When a user submits a comment on a reel, the frontend will send a POST request to this endpoint with the comment text.
    const reelId = req.params.id;
    const userId = req.user.userId;
    const { text } = req.body;

    if (!text || text.trim() === '') return res.status(400).json({ error: 'Comment cannot be empty' });

    // We insert the new comment into the reel_comments table, associating it with the reel ID and user ID. After inserting, we immediately
    // fetch the newly created comment along with the user's name and picture so we can return it in the response.
    const sql = `INSERT INTO reel_comments (reel_id, user_id, text) VALUES (?, ?, ?)`;
    db.run(sql, [reelId, userId, text], function(err) {
        if (err) return res.status(500).json({ error: 'Failed to post reel comment' });
        
        // Immediately fetch the newly created comment with the user's data so the frontend can append it instantly
        db.get(`
            SELECT reel_comments.*, users.name, users.picture 
            FROM reel_comments 
            JOIN users ON reel_comments.user_id = users.id 
            WHERE reel_comments.id = ?
        `, [this.lastID], (fetchErr, row) => {
            if (fetchErr) return res.status(500).json({ error: 'Failed to retrieve new reel comment' });
            res.status(201).json(row);
        });
    });
});

// Securely Edit a Reel Comment (15 Minute Window)
app.put('/api/reel_comments/:id', authenticateToken, (req, res) => {
    const commentId = req.params.id;
    const userId = req.user.userId;
    const { text } = req.body;

    if (!text || text.trim() === '') return res.status(400).json({ error: 'Comment cannot be empty' });

    // First, we fetch the comment to check ownership and timestamp
    // We ensure that the user trying to edit the comment is the original author and that they are within the 15-minute window for edits.
    db.get(`SELECT * FROM reel_comments WHERE id = ?`, [commentId], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Comment not found' });
        if (row.user_id !== userId) return res.status(403).json({ error: 'Unauthorized to edit this comment' });

        // SQLite stores CURRENT_TIMESTAMP in UTC. We append 'Z' to ensure JS parses it correctly.
        // We calculate how many minutes have passed since the comment was posted. If it's more than 15, we deny the edit.
        const commentTime = new Date(row.timestamp + 'Z').getTime();
        if ((Date.now() - commentTime) / (1000 * 60) > 15) {
            return res.status(403).json({ error: 'The 15-minute edit window has expired.' });
        }

        // If both checks pass, we allow the update to proceed. We use a parameterized query to safely update the comment text.
        db.run(`UPDATE reel_comments SET text = ? WHERE id = ?`, [text, commentId], function(updateErr) {
            if (updateErr) return res.status(500).json({ error: 'Failed to update comment' });
            res.status(200).json({ success: true, text });
        });
    });
});

// Securely Delete a Reel Comment (15 Minute Window)
app.delete('/api/reel_comments/:id', authenticateToken, (req, res) => {
    const commentId = req.params.id;
    const userId = req.user.userId;

    // Similar to the edit route, we first check if the comment exists and if the requesting user is the author. Then we check if it's 
    // still within the allowed deletion time frame before allowing the delete operation.
    db.get(`SELECT * FROM reel_comments WHERE id = ?`, [commentId], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Comment not found' });
        if (row.user_id !== userId) return res.status(403).json({ error: 'Unauthorized to delete this comment' });

        // SQLite stores CURRENT_TIMESTAMP in UTC. We append 'Z' to ensure JS parses it correctly. We calculate how many minutes 
        // have passed since the comment was posted. If it's more than 15, we deny the deletion.
        const commentTime = new Date(row.timestamp + 'Z').getTime();
        if ((Date.now() - commentTime) / (1000 * 60) > 15) {
            return res.status(403).json({ error: 'The 15-minute deletion window has expired.' });
        }

        // If both checks pass, we allow the delete to proceed. We use a parameterized query to safely delete the comment.
        db.run(`DELETE FROM reel_comments WHERE id = ?`, [commentId], function(delErr) {
            if (delErr) return res.status(500).json({ error: 'Failed to delete comment' });
            res.status(200).json({ success: true, reelId: row.reel_id });
        });
    });
});


// 12. REELS ROUTES (Videos)

// These routes follow the same pattern as the posts routes. 
// We have a check route to prevent duplicates, a POST route to create new reels, 
// and a GET route to retrieve them with pagination. The main difference is that 
// reels are simpler objects (just video_id, title, and channel_name) compared to the rich article posts.
// Added verifyScraper middleware to protect this route
app.post('/api/reels/check', verifyScraper, (req, res) => {
    const { video_id } = req.body;
    db.get(`SELECT id FROM reels WHERE video_id = ?`, [video_id], (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ exists: !!row }); 
    });
});

// The video_id is the unique identifier for YouTube videos (the string in the URL after 'v=').
// For example, in https://www.youtube.com/watch?v=dQw4w9WgXcQ, the video_id is 'dQw4w9WgXcQ'.
// The title and channel_name are just metadata to display in the UI.
// We could expand this later to include things like thumbnail URLs, view counts, etc.
// This is the POST route (save reels to the database) that the scraper will hit when it finds a new sports highlight 
// reel to save in the database.
// Added verifyScraper middleware to protect this route
app.post('/api/reels', verifyScraper, (req, res) => {
    const { video_id, title, channel_name } = req.body;
    if (!video_id || !title) return res.status(400).json({ error: 'Missing required video fields' });

    const sql = `INSERT INTO reels (video_id, title, channel_name) VALUES (?, ?, ?)`;
    db.run(sql, [video_id, title, channel_name], function(err) {
        if (err) return res.status(500).json({ error: 'Failed to save reel' });
        res.status(201).json({ message: 'Reel saved!', reelId: this.lastID });
    });
});

// This GET route retrieves reels with pagination, similar to the posts route, essentially
// fetching reels for the Next.js frontend to display in the reels section.
// Replaced the 'page/offset' chronological logic with a dynamic 'exclude' list and 'ORDER BY RANDOM()'.
// Upgraded GET /api/reels to safely prioritize deep-linked reel IDs from the profile vault
app.get('/api/reels', (req, res) => {
    // Force Cloudflare and mobile browsers to NEVER cache this feed
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');

    // We still allow a 'limit' query parameter to control how many reels we return at once (default 3).
    const limit = parseInt(req.query.limit) || 3;
    const exclude = req.query.exclude || ''; // Capture the list of IDs from the frontend
    const forceId = req.query.reelId || null; // Capture explicit target video_id from URL query string
    
    // Optional Authentication Check
    // If the frontend sends a token, we verify it to get the user ID. 
    // This allows us to personalize the reels feed in the future (e.g., show which reels they've liked).
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    let userId = null;

    // If there's a token, we try to verify it. If it's valid, we extract the 
    // user ID from the token's payload.
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            userId = decoded.userId;
        } catch (err) {}
    }

    // Added the subquery `(SELECT COUNT(*) FROM reel_comments WHERE reel_id = reels.id) AS commentCount` to both branches
    // Dynamic SQL builder - if we have a userId, we include the subquery to check if they've liked each reel.
    //  If not, we just return 0 for userLiked. We do the same for userSaved as well
    let sql = userId
        ? `SELECT reels.*, 
           EXISTS(SELECT 1 FROM reel_likes WHERE reel_id = reels.id AND user_id = ?) AS userLiked,
           EXISTS(SELECT 1 FROM saved_reels WHERE reel_id = reels.id AND user_id = ?) AS userSaved,
           (SELECT COUNT(*) FROM reel_comments WHERE reel_id = reels.id) AS commentCount
           FROM reels`
        : `SELECT reels.*, 0 AS userLiked, 0 AS userSaved,
           (SELECT COUNT(*) FROM reel_comments WHERE reel_id = reels.id) AS commentCount
           FROM reels`;
    
    // The 'exclude' parameter allows the frontend to tell us which reels it has already displayed, 
    // so we can avoid showing the same ones again as the user scrolls.
    let params = [];
    if (userId) {
        params.push(userId, userId); // For the userLiked and userSaved subqueries
    }

    // Build the dynamic WHERE statements
    let whereClauses = [];

    // If we have an explicit target reelId from a Vault click, skip the regular exclude lists for the top item
    if (forceId) {
        whereClauses.push(`video_id = ?`);
        params.push(forceId);
    } else {
        // Ensures the main random feed ONLY pulls fresh reels from the last 7 days.
        whereClauses.push(`timestamp >= datetime('now', '-7 days')`);

        // Convert the string "1,4,7" into an array of integers [1, 4, 7]
        // We also filter out any non-numeric values just in case the frontend sends something unexpected.
        // The 'exclude' query parameter is expected to be a comma-separated string of reel IDs that the frontend has already displayed.
        if (exclude) {
            const excludeIds = exclude.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
            
            // If there are valid IDs to exclude, we modify the SQL query to add a NOT IN clause safely.
            // This tells the database to skip any reels whose IDs are in the exclude list. We also push those IDs 
            // into the params array so they get safely substituted into the query.
            if (excludeIds.length > 0) {
                // Generate the exact number of ? placeholders needed (e.g. ?, ?, ?)
                const placeholders = excludeIds.map(() => '?').join(',');
                whereClauses.push(`id NOT IN (${placeholders})`);
                params.push(...excludeIds); // Push all excluded IDs into the params array
            }
        }
    }

    // If any clauses were added, safely combine them and append a single WHERE keyword to the SQL statement
    if (whereClauses.length > 0) {
        sql += ` WHERE ` + whereClauses.join(' AND ');
    }

   // If 'forceId' is present, we want to fetch that specific reel, so we limit the results to 1 without randomization.
   // If 'forceId' is not present, we want to fetch a random selection of reels while respecting the exclude list, so we 
   // order by RANDOM() and limit by the specified number.
   sql += forceId ? ` LIMIT 1` : ` ORDER BY RANDOM() LIMIT ?`;
   if (!forceId) {
       params.push(limit);
   }

    // Finally, we execute the query with the constructed SQL and parameters. 
    // The database engine will safely substitute the parameters into the query.
    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Map SQLite 1/0 to true/false
        const formattedRows = rows.map(row => ({
            ...row,
            userLiked: row.userLiked === 1,
            userSaved: row.userSaved === 1
        }));

        // Dual-stage response padding layout
        // If we forced a single specific video, immediately run a background fallback query 
        // to grab normal random items, so the layout feed isn't an empty dead-end string.
        if (forceId && formattedRows.length > 0) {
            // Updated fallback query to also pull commentCount
            let fallbackSql = userId
                ? `SELECT reels.*, 
                   EXISTS(SELECT 1 FROM reel_likes WHERE reel_id = reels.id AND user_id = ?) AS userLiked,
                   EXISTS(SELECT 1 FROM saved_reels WHERE reel_id = reels.id AND user_id = ?) AS userSaved,
                   (SELECT COUNT(*) FROM reel_comments WHERE reel_id = reels.id) AS commentCount
                   FROM reels WHERE video_id != ? AND timestamp >= datetime('now', '-7 days') ORDER BY RANDOM() LIMIT ?`
                : `SELECT reels.*, 0 AS userLiked, 0 AS userSaved, (SELECT COUNT(*) FROM reel_comments WHERE reel_id = reels.id) AS commentCount FROM reels WHERE video_id != ? AND timestamp >= datetime('now', '-7 days') ORDER BY RANDOM() LIMIT ?`;

            let fallbackParams = userId ? [userId, userId, forceId, limit] : [forceId, limit];
            
            // We run the fallback query in the background. If it fails, we just return the single forced video. 
            // If it succeeds, we append those random videos to the response.
            db.all(fallbackSql, fallbackParams, (fallbackErr, fallbackRows) => {
                if (fallbackErr) return res.json(formattedRows); // Gracefully fall back to single video if query drops
                
                // Map the fallback rows to convert userLiked and userSaved to booleans as well
                const formattedFallback = fallbackRows.map(row => ({
                    ...row,
                    userLiked: row.userLiked === 1,
                    userSaved: row.userSaved === 1
                }));

                // Combine the requested video AT THE TOP [0] with random videos appended below it
                res.json([...formattedRows, ...formattedFallback]);
            });
        } else {
            // Normal passive random scrolling response stream
            res.json(formattedRows);
        }
    });
});

// 13. MATCHES ROUTES (Match Center live scores)
// Ingestion-facing write route: server/liveScores.js POSTs batches of normalized matches here
// on two cadences (ESPN every minute, CricketData.org every 20 minutes - see that file).
// Protected by the same verifyScraper bouncer as the posts/reels ingestion routes.
// Frontend-facing GET routes (list/detail) are added separately.
app.post('/api/matches', verifyScraper, (req, res) => {
    const { matches } = req.body;
    if (!Array.isArray(matches) || matches.length === 0) {
        return res.status(400).json({ error: 'Missing or empty matches array' });
    }

    const sql = `
        INSERT INTO matches (league_id, vendor, external_id, home_team, away_team, home_logo, away_logo, home_score, away_score, score_summary, status, start_time, clock, tournament, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(vendor, external_id) DO UPDATE SET
            home_team = excluded.home_team,
            away_team = excluded.away_team,
            home_logo = excluded.home_logo,
            away_logo = excluded.away_logo,
            home_score = excluded.home_score,
            away_score = excluded.away_score,
            score_summary = excluded.score_summary,
            status = excluded.status,
            start_time = excluded.start_time,
            clock = excluded.clock,
            tournament = excluded.tournament,
            last_updated = CURRENT_TIMESTAMP
    `;

    let upserted = 0;
    let failed = 0;
    matches.forEach((m) => {
        db.run(sql, [
            m.league_id, m.vendor, m.external_id, m.home_team, m.away_team,
            m.home_logo ?? null, m.away_logo ?? null,
            m.home_score, m.away_score, m.score_summary, m.status, m.start_time, m.clock,
            m.tournament ?? null,
        ], (err) => {
            if (err) { failed++; console.error('Error upserting match:', err.message); }
            else upserted++;

            // Fire the response once every row has been attempted (order-independent, since
            // db.run callbacks can complete out of order under sqlite3's internal queueing).
            if (upserted + failed === matches.length) {
                res.status(failed > 0 ? 207 : 200).json({ upserted, failed });
            }
        });
    });
});

// Frontend-facing list route - no auth required yet (favorites-first personalization,
// mirroring how Posts personalization layered optional-auth onto an already-public route,
// is its own later task). Optional ?league_id= scopes to a single league for a single card.
// Scores are just as freshness-critical as Reels, so the same no-cache headers apply.
//
// Ordering puts live matches first, then scheduled (soonest start first), then final (most
// recent first) - the negated epoch trick lets one ORDER BY handle both sort directions
// (ascending for "soonest", descending for "most recent") without a second query or UNION.
app.get('/api/matches', (req, res) => {
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');

    const { league_id } = req.query;

    // Two payload guards, both added when the hourly fixtures sweep started widening
    // what's in the table (a month of MLB alone is ~400 rows):
    // - a hard window on start_time (mirrors the ingestion sweep's own reach, and keeps
    //   null-start_time rows - a rare cricket case - rather than silently dropping them);
    // - a per-league relevance cap via ROW_NUMBER: live matches always survive, then
    //   whatever is nearest in time to right now, forward or back. This is what keeps
    //   tennis's ~500 rows/day from drowning the response while every league's card
    //   still gets its last + next matchday.
    const inner = `
        SELECT *, ROW_NUMBER() OVER (
            PARTITION BY league_id
            ORDER BY
                CASE status WHEN 'live' THEN 0 ELSE 1 END ASC,
                COALESCE(ABS(strftime('%s', start_time) - strftime('%s', 'now')), 1e15) ASC
        ) AS relevance_rank
        FROM matches
        WHERE (start_time IS NULL OR start_time >= datetime('now', '-8 days'))
        ${league_id ? 'AND league_id = ?' : ''}
    `;
    const params = league_id ? [league_id] : [];

    const sql = `
        SELECT id, league_id, vendor, external_id, home_team, away_team, home_logo, away_logo,
               home_score, away_score, score_summary, status, start_time, clock, tournament, last_updated
        FROM (${inner})
        WHERE relevance_rank <= 60
        ORDER BY
            CASE status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END ASC,
            CASE WHEN status = 'final'
                THEN -CAST(strftime('%s', start_time) AS INTEGER)
                ELSE CAST(strftime('%s', start_time) AS INTEGER)
            END ASC
    `;

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Single-match detail route, keyed on our own internal id (not the vendor's external_id) -
// for the future match-detail stretch view.
app.get('/api/matches/:id', (req, res) => {
    db.get(`SELECT * FROM matches WHERE id = ?`, [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Match not found' });
        res.json(row);
    });
});

// Box-score detail for the match-detail view: proxies ESPN's per-event summary endpoint
// (linescores by period/inning + team stat comparisons) live rather than ingesting box
// scores into SQLite - detail data is only interesting while someone is actually looking
// at it. A 60-second in-memory cache (hits AND misses) means a detail page polling every
// 30s, or many users on the same big game, still costs ESPN at most one request a minute
// per match. Non-ESPN matches (cricket) and sports whose summary shape doesn't fit
// (tennis) return 404 and the frontend renders its hero-only fallback.
const matchSummaryCache = new Map(); // match id -> { expiresAt, status, body }
const SUMMARY_CACHE_MS = 60 * 1000;

app.get('/api/matches/:id/summary', (req, res) => {
    const cached = matchSummaryCache.get(req.params.id);
    if (cached && cached.expiresAt > Date.now()) {
        return res.status(cached.status).json(cached.body);
    }

    const respond = (status, body) => {
        matchSummaryCache.set(req.params.id, { expiresAt: Date.now() + SUMMARY_CACHE_MS, status, body });
        // Drop expired entries opportunistically so the cache can't grow unbounded
        for (const [key, entry] of matchSummaryCache) {
            if (entry.expiresAt <= Date.now()) matchSummaryCache.delete(key);
        }
        res.status(status).json(body);
    };

    db.get(`SELECT * FROM matches WHERE id = ?`, [req.params.id], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return respond(404, { error: 'Match not found' });
        if (row.vendor !== 'espn') return respond(404, { error: 'No box score available for this match' });

        const league = ESPN_LEAGUES.find((l) => l.league_id === row.league_id);
        if (!league || league.sport === 'tennis') {
            return respond(404, { error: 'No box score available for this match' });
        }

        try {
            const url = `https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.slug}/summary?event=${encodeURIComponent(row.external_id)}`;
            const espnRes = await fetch(url);
            if (!espnRes.ok) return respond(404, { error: 'No box score available for this match' });
            const summary = await espnRes.json();

            const competitors = summary.header?.competitions?.[0]?.competitors || [];
            const home = competitors.find((c) => c.homeAway === 'home');
            const away = competitors.find((c) => c.homeAway === 'away');
            if (!home || !away) return respond(404, { error: 'No box score available for this match' });

            const side = (c) => ({
                linescores: (c.linescores || []).map((p) => p.displayValue ?? String(p.value ?? '')),
                record: c.record?.[0]?.summary || null,
            });

            // Pair the two teams' stat lists by stat name (ESPN emits them per-team).
            // Matched to home/away via team id, never array order - boxscore.teams order
            // varies by sport.
            const boxTeams = summary.boxscore?.teams || [];
            const homeBox = boxTeams.find((t) => t.team?.id === home.team?.id);
            const awayBox = boxTeams.find((t) => t.team?.id === away.team?.id);
            // Some sports (baseball) group team stats a level deeper with no top-level
            // displayValue - a pair only counts when both sides have a real value to show,
            // otherwise JSON.stringify silently drops the undefined and breaks consumers.
            const stats = (homeBox?.statistics || [])
                .map((stat) => {
                    const awayStat = (awayBox?.statistics || []).find((s) => s.name === stat.name);
                    return awayStat && stat.displayValue != null && awayStat.displayValue != null
                        ? { label: stat.label || stat.name, home: stat.displayValue, away: awayStat.displayValue }
                        : null;
                })
                .filter(Boolean)
                .slice(0, 12);

            // Soccer only: goalscorers from keyEvents (scorer name, minute, penalty/own-goal
            // flags). Shootout conversions are excluded - the shootout result is already the
            // score line, and listing 8+ "scorers" for it drowns the real goals. Other sports
            // omit the field entirely rather than sending an empty array.
            let scorers;
            if (league.sport === 'soccer') {
                scorers = (summary.keyEvents || [])
                    .filter((e) => e.scoringPlay && !e.shootout)
                    .map((e) => {
                        // keyEvents carry the scorer as participants[0].athlete (participants[1]
                        // is the assist); athletesInvolved is the scoreboard-details shape, kept
                        // as a fallback. Penalty/own-goal ride in type.text here ("Penalty - Scored",
                        // "Own Goal"), not the boolean flags the scoreboard shape uses.
                        const athlete = e.participants?.[0]?.athlete || e.athletesInvolved?.[0];
                        const typeText = e.type?.text || '';
                        return {
                            name: athlete?.shortName || athlete?.displayName || 'Unknown',
                            minute: e.clock?.displayValue || '',
                            team: e.team?.id === home.team?.id ? 'home' : 'away',
                            penalty: !!e.penaltyKick || /penalt/i.test(typeText),
                            ownGoal: !!e.ownGoal || /own goal/i.test(typeText),
                        };
                    });
            }

            respond(200, {
                home: side(home),
                away: side(away),
                stats,
                ...(scorers ? { scorers } : {}),
                venue: summary.gameInfo?.venue?.fullName || null,
                attendance: summary.gameInfo?.attendance || null,
            });
        } catch (fetchErr) {
            console.error('Error fetching ESPN summary:', fetchErr.message);
            respond(404, { error: 'No box score available for this match' });
        }
    });
});

// 14. THE VAULT (User Profile Data)
// This route fetches everything a user has interacted with. 
// It requires the 'authenticateToken' bouncer to ensure we know exactly who is asking.
app.get('/api/users/me/vault', authenticateToken, async (req, res) => {
    const userId = req.user.userId;

    // Define our 5 targeted SQL queries
    // Added a 6th query to grab reel comments for the vault!
    const queries = {
        likedPosts: `SELECT posts.*, 1 AS userLiked FROM posts 
                     INNER JOIN post_likes ON posts.id = post_likes.post_id 
                     WHERE post_likes.user_id = ? ORDER BY posts.timestamp DESC`,
                     
        savedPosts: `SELECT posts.*, 1 AS userSaved FROM posts 
                     INNER JOIN saved_posts ON posts.id = saved_posts.post_id 
                     WHERE saved_posts.user_id = ? ORDER BY posts.timestamp DESC`,
                     
        likedReels: `SELECT reels.*, 1 AS userLiked FROM reels 
                     INNER JOIN reel_likes ON reels.id = reel_likes.reel_id 
                     WHERE reel_likes.user_id = ? ORDER BY reels.timestamp DESC`,
                     
        savedReels: `SELECT reels.*, 1 AS userSaved FROM reels 
                     INNER JOIN saved_reels ON reels.id = saved_reels.reel_id 
                     WHERE saved_reels.user_id = ? ORDER BY reels.timestamp DESC`,
                     
        userComments: `SELECT comments.*, posts.headline AS post_headline
                       FROM comments INNER JOIN posts ON comments.post_id = posts.id 
                       WHERE comments.user_id = ? ORDER BY comments.timestamp DESC`,

        userReelComments: `SELECT reel_comments.*, reels.title AS reel_title
                       FROM reel_comments INNER JOIN reels ON reel_comments.reel_id = reels.id 
                       WHERE reel_comments.user_id = ? ORDER BY reel_comments.timestamp DESC`
    };

    // Helper function to wrap SQLite callbacks in modern Promises
    // This allows us to use async/await syntax for cleaner code when executing multiple queries in parallel.
    const fetchQuery = (query, params) => {
        // We return a new Promise (JavaScript object that represents the eventual completion (or failure) of an 
        // asynchronous operation and its resulting value) that wraps the db.all method. The Promise constructor takes a function with 
        // 'resolve' and 'reject' parameters, which we call based on whether the database query succeeds or fails.
        // If the query encounters an error, we call 'reject(err)' which will cause the Promise to fail and jump to the catch block.
        // If the query is successful, we call 'resolve(rows)' which will pass the resulting rows to the next step in our async function.
        return new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    };

    try {
        // Execute all database queries at the exact same time
        // Promise.all takes an array of Promises and returns a new Promise that resolves when all of the input Promises have resolved.
        const [likedPosts, savedPosts, likedReels, savedReels, userComments, userReelComments] = await Promise.all([
            fetchQuery(queries.likedPosts, [userId]),
            fetchQuery(queries.savedPosts, [userId]),
            fetchQuery(queries.likedReels, [userId]),
            fetchQuery(queries.savedReels, [userId]),
            fetchQuery(queries.userComments, [userId]),
            fetchQuery(queries.userReelComments, [userId]) 
        ]);

        // Send a massive, beautifully organized JSON payload back to the frontend
        res.status(200).json({
            likedPosts,
            savedPosts,
            likedReels,
            savedReels,
            userComments,
            userReelComments 
        });
    } catch (error) {
        console.error("Vault fetch error:", error);
        res.status(500).json({ error: 'Failed to retrieve vault data' });
    }
});

// PUT: Update the user's global profile (Name & Picture)
app.put('/api/users/me/profile', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { name, picture } = req.body;

    if (!name || !picture) {
        return res.status(400).json({ error: 'Name and picture are required.' });
    }

    // A freshly-uploaded picture arrives as a base64 data URL (see profile/page.tsx's
    // FileReader) and needs to go to R2. An unchanged OAuth-provider picture or the
    // ui-avatars.com fallback is already a plain URL - pass those through untouched.
    let pictureUrl = picture;
    if (picture.startsWith('data:image')) {
        try {
            pictureUrl = await uploadProfilePicture(userId, picture);
        } catch (uploadErr) {
            console.error("Failed to upload profile picture to R2:", uploadErr.message);
            return res.status(500).json({ error: 'Failed to upload profile picture' });
        }
    }

    // Update the master users table with the new custom profile data
    db.run(`UPDATE users SET name = ?, picture = ? WHERE id = ?`, [name, pictureUrl, userId], function(err) {
        if (err) {
            console.error("Failed to update profile:", err.message);
            return res.status(500).json({ error: 'Failed to update profile in database' });
        }
        res.status(200).json({ success: true, message: 'Profile synced globally!', picture: pictureUrl });
    });
});

// 15. USER PREFERENCES ROUTES (Protected by authenticateToken)
// These routes handle reading and saving the user's custom league selections for the Live Scores dashboard.

// GET: Retrieve the user's saved leagues
app.get('/api/users/me/preferences', authenticateToken, (req, res) => {
    const userId = req.user.userId;

    // We query the user_preferences table for all league_id entries that match this user_id. This will return an array 
    // of rows, each containing a league_id that the user has selected.
    db.all(`SELECT league_id FROM user_preferences WHERE user_id = ?`, [userId], (err, rows) => {
        if (err) {
            console.error("Error fetching preferences:", err.message);
            return res.status(500).json({ error: 'Failed to retrieve preferences' });
        }
        // Map the database rows into a simple array of strings (e.g., ['nba', 'premier_league'])
        const preferences = rows.map(row => row.league_id);
        res.status(200).json({ preferences });
    });
});

// POST: Save/Update the user's chosen leagues
app.post('/api/users/me/preferences', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const { leagues } = req.body; // Expects an array of league ID strings

    // Basic validation to ensure we received an array of leagues. If not, we return a 400 Bad Request status with an error message.
    if (!Array.isArray(leagues)) {
        return res.status(400).json({ error: 'Leagues must be provided as an array.' });
    }

    // We use serialize to ensure the DELETE finishes completely before the INSERTs begin
    db.serialize(() => {
        // Step 1: Wipe the old preferences for this specific user to ensure a clean slate
        db.run(`DELETE FROM user_preferences WHERE user_id = ?`, [userId], function(err) {
            if (err) {
                console.error("Error clearing old preferences:", err.message);
                return res.status(500).json({ error: 'Failed to update preferences' });
            }

            // Step 2: If the user passed an empty array (meaning they cleared everything), just return success early.
            if (leagues.length === 0) {
                return res.status(200).json({ message: 'Preferences cleared successfully' });
            }

            // Step 3: Prepare the insert statement for the new leagues
            const stmt = db.prepare(`INSERT INTO user_preferences (user_id, league_id) VALUES (?, ?)`);
            
            // We run the insert statement for each league ID in the array. If any insert fails, we set a flag to indicate an error occurred.
            let hasError = false;
            leagues.forEach(leagueId => {
                stmt.run(userId, leagueId, (insertErr) => {
                    if (insertErr) hasError = true;
                });
            });

            stmt.finalize(() => {
                if (hasError) {
                    return res.status(500).json({ error: 'Failed to save some preferences' });
                }
                res.status(200).json({ message: 'Preferences updated successfully!' });
            });
        });
    });
});

// Data Retention Cleanup Routine (7-Day Limit)
// This function runs every 12 hours to delete posts and reels older than 7 days, keeping the database light and fast.
const cleanOldData = () => {
    console.log("🧹 Running 7-day data retention sweep...");
    db.serialize(() => {
        // Define the exact exclusion rules (Approach A). Keep items if liked, saved, or commented!
        const deadPosts = `timestamp <= datetime('now', '-7 days') AND id NOT IN (SELECT post_id FROM saved_posts) AND id NOT IN (SELECT post_id FROM post_likes) AND id NOT IN (SELECT post_id FROM comments)`;
        
        // HIGHLIGHT: Updated deadReels to ensure reels aren't deleted if they have comments
        const deadReels = `timestamp <= datetime('now', '-7 days') AND id NOT IN (SELECT reel_id FROM saved_reels) AND id NOT IN (SELECT reel_id FROM reel_likes) AND id NOT IN (SELECT reel_id FROM reel_comments)`;

        // Remove old entries from the FTS5 global_search index ONLY for truly dead items
        db.run(`DELETE FROM global_search WHERE doc_type = 'POST' AND doc_id IN (SELECT id FROM posts WHERE ${deadPosts})`);
        db.run(`DELETE FROM global_search WHERE doc_type = 'REEL' AND doc_id IN (SELECT id FROM reels WHERE ${deadReels})`);
        
        // HIGHLIGHT: Removed the blind deletion of junction data (likes, saves, comments). 
        // We WANT to keep those if they exist! The query will now gracefully leave them alone.

        // Finally, delete the actual posts and reels that are officially dead
        db.run(`DELETE FROM posts WHERE ${deadPosts}`, function(err) {
            if (!err && this.changes > 0) console.log(`   -> Deleted ${this.changes} old posts.`);
        });
        db.run(`DELETE FROM reels WHERE ${deadReels}`, function(err) {
            if (!err && this.changes > 0) console.log(`   -> Deleted ${this.changes} old reels.`);
        });

        // Matches has no "keep if interacted with" concept the way posts/reels do, so this is
        // a plain age cutoff on start_time. 10 days: comfortably past the fixtures sweep's
        // 7-day backward reach (liveScores.js), so "last matchday" results survive between
        // sweeps - this sweep only exists to stop the table from growing unbounded, not to
        // be its source of truth for staleness.
        db.run(`DELETE FROM matches WHERE start_time <= datetime('now', '-10 days')`, function(err) {
            if (!err && this.changes > 0) console.log(`   -> Deleted ${this.changes} old matches.`);
        });
    });
    console.log("🧹 Data retention sweep completed.");
};

// Hidden Admin Route to track scaling limits
// Visit https://your-render-url.onrender.com/api/admin/stats to view
app.get('/api/admin/stats', (req, res) => {
    db.get('SELECT count(*) as total_users FROM users', (err, users) => {
        db.get('SELECT count(*) as total_posts FROM posts', (err, posts) => {
            res.json({ 
                status: 'Healthy',
                users: users ? users.total_users : 0, 
                posts: posts ? posts.total_posts : 0 
            });
        });
    });
});

// Run the cleanup immediately on boot, then every 12 hours
cleanOldData();
setInterval(cleanOldData, 12 * 60 * 60 * 1000);

// Error Handling Middleware
Sentry.setupExpressErrorHandler(app);

// 16. SERVER BINDING
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    
    // Wait 2 seconds AFTER the server binds to the port to ensure it is 100% ready before unleashing the scraper
    setTimeout(() => {
        require('./scraper.js');
        require('./liveScores.js');
    }, 2000);
});