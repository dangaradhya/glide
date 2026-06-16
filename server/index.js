// 1. IMPORTS (The equivalent of #include in C++ or 'use' in Rust)
// 'require' is how Node.js pulls in external libraries from your node_modules folder.
require('dotenv').config(); // Loads your GOOGLE_CLIENT_ID from the .env file
const express = require('express');
const sqlite3 = require('sqlite3').verbose(); // verbose() gives us detailed error stack traces
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

// 2. INITIALIZATION
// This creates our application instance. Think of this like initializing your Axum router in Rust.
const app = express();
const PORT = 3000; // The port our server will listen on
// In production, this lives in a .env file. We hardcode it here for development.
const JWT_SECRET = 'glide_super_secret_key_2026';

// For Google Sign-In, we need to set up the OAuth2 client with our Google Client ID.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// 3. MIDDLEWARE
// Middleware are functions that intercept incoming HTTP requests before they hit your routes.
// cors() allows your React frontend (which will run on a different port) to talk to this backend without security blocks.
app.use(cors()); 
// express.json() parses incoming JSON payloads (like when we POST new data). 
// Without this, the body of an incoming request would just be raw bytes.
app.use(express.json());

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
const db = new sqlite3.Database('./glide.sqlite', (err) => {
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

        // Check if this Google user already exists in our database by looking up their google_id.
        db.get(`SELECT id FROM users WHERE google_id = ?`, [google_id], (err, user) => {
            if (err) return res.status(500).json({ error: 'Database error' });

            if (user) {
                // User exists, generate Glide JWT and log them in
                const glideToken = jwt.sign({ userId: user.id, email: email }, JWT_SECRET, { expiresIn: '90d' });
                return res.status(200).json({ token: glideToken, user: { id: user.id, name, picture } });
            } else {
                // New user! Save them to the database first
                db.run(`INSERT INTO users (google_id, email, name, picture) VALUES (?, ?, ?, ?)`, 
                [google_id, email, name, picture], function(insertErr) {
                    if (insertErr) return res.status(500).json({ error: 'Failed to create user' });
                    
                    // After inserting, 'this.lastID' gives us the ID of the newly created user. We use that to generate the JWT token.
                    const glideToken = jwt.sign({ userId: this.lastID, email: email }, JWT_SECRET, { expiresIn: '90d' });
                    res.status(201).json({ token: glideToken, user: { id: this.lastID, name, picture } });
                });
            }
        });
    } catch (error) {
        console.error("Google Auth Error:", error);
        res.status(401).json({ error: 'Invalid Google token' });
    }
});

// 6. ROUTING (The API Endpoints)
// When a client visits http://localhost:3000/api/health it fires this callback function. 
// 'req' is the incoming request, 'res' is the outgoing response.
app.get('/api/health', (req, res) => {
    // We send back a standard HTTP 200 OK status with a JSON payload.
    res.status(200).json({ status: 'Online', message: 'Glide API is running' });
});

// THE DEDUPLICATION CHECKER ROUTE (The Gatekeeper)
// The scraper hits this route first to see if a URL already exists in the database.
app.post('/api/posts/check', (req, res) => {
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
app.post('/api/posts', (req, res) => {
    const { sport_category, headline, content, excitement_level, url, image_url } = req.body;

    // Basic validation: Check if the request is missing any data.
    if (!sport_category || !headline || !content || !excitement_level || !url) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

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

// 9. READING DATA (The GET Route - 'read operation')
// Big Picture: When a user opens Glide on their phone or laptop, the UI is completely empty. 
// The frontend immediately fires off a GET request to your server asking for the latest data to display.
app.get('/api/posts', (req, res) => {
    // Extract query parameters with fallbacks (default to page 1, limit 5)
    // We use a small limit of 5 so you can easily test the "Load More" button!
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    
    // Calculate the offset (e.g., if page 2 and limit 5, skip the first 5 records)
    const offset = (page - 1) * limit;

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

    // Dynamic SQL based on Auth Status
    const sql = userId 
        ? `SELECT posts.*, 
             EXISTS(SELECT 1 FROM post_likes WHERE post_id = posts.id AND user_id = ?) AS userLiked,
             EXISTS(SELECT 1 FROM saved_posts WHERE post_id = posts.id AND user_id = ?) AS userSaved,
             (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) AS commentCount
           FROM posts ORDER BY timestamp DESC LIMIT ? OFFSET ?`
        : `SELECT posts.*, 0 AS userLiked, 0 AS userSaved,
             (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) AS commentCount 
           FROM posts ORDER BY timestamp DESC LIMIT ? OFFSET ?`;

    // The parameters we pass to the database depend on whether we have a userId or not. 
    // If we do, we need to include it for the subquery that checks if the user liked each post.
    // Because we added a second ? for the userSaved subquery, we must pass userId TWICE in the array 
    // (once for userLiked and once for userSaved), followed by the limit and offset.
    const params = userId ? [userId, userId, limit, offset] : [limit, offset];
    
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

        res.status(200).json(formattedRows);
    });
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


// 12. REELS ROUTES (Videos)

// These routes follow the same pattern as the posts routes. 
// We have a check route to prevent duplicates, a POST route to create new reels, 
// and a GET route to retrieve them with pagination. The main difference is that 
// reels are simpler objects (just video_id, title, and channel_name) compared to the rich article posts.
app.post('/api/reels/check', (req, res) => {
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
app.post('/api/reels', (req, res) => {
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

    // Dynamic SQL builder - if we have a userId, we include the subquery to check if they've liked each reel.
    //  If not, we just return 0 for userLiked. We do the same for userSaved as well
    let sql = userId
        ? `SELECT reels.*, 
           EXISTS(SELECT 1 FROM reel_likes WHERE reel_id = reels.id AND user_id = ?) AS userLiked,
           EXISTS(SELECT 1 FROM saved_reels WHERE reel_id = reels.id AND user_id = ?) AS userSaved
           FROM reels`
        : `SELECT reels.*, 0 AS userLiked, 0 AS userSaved
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
    } else if (exclude) {
        // Convert the string "1,4,7" into an array of integers [1, 4, 7]
        // We also filter out any non-numeric values just in case the frontend sends something unexpected.
        // The 'exclude' query parameter is expected to be a comma-separated string of reel IDs that the frontend has already displayed.
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
            let fallbackSql = userId
                ? `SELECT reels.*, 
                   EXISTS(SELECT 1 FROM reel_likes WHERE reel_id = reels.id AND user_id = ?) AS userLiked,
                   EXISTS(SELECT 1 FROM saved_reels WHERE reel_id = reels.id AND user_id = ?) AS userSaved
                   FROM reels WHERE video_id != ? ORDER BY RANDOM() LIMIT ?`
                : `SELECT reels.*, 0 AS userLiked, 0 AS userSaved FROM reels WHERE video_id != ? ORDER BY RANDOM() LIMIT ?`;

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

// 13. THE VAULT (User Profile Data)
// This route fetches everything a user has interacted with. 
// It requires the 'authenticateToken' bouncer to ensure we know exactly who is asking.
app.get('/api/users/me/vault', authenticateToken, async (req, res) => {
    const userId = req.user.userId;

    // Define our 4 targeted SQL queries
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
                     WHERE saved_reels.user_id = ? ORDER BY reels.timestamp DESC`
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
        // Execute all 4 database queries at the exact same time
        // Promise.all takes an array of Promises and returns a new Promise that resolves when all of the input Promises have resolved.
        const [likedPosts, savedPosts, likedReels, savedReels] = await Promise.all([
            fetchQuery(queries.likedPosts, [userId]),
            fetchQuery(queries.savedPosts, [userId]),
            fetchQuery(queries.likedReels, [userId]),
            fetchQuery(queries.savedReels, [userId])
        ]);

        // Send a massive, beautifully organized JSON payload back to the frontend
        res.status(200).json({
            likedPosts,
            savedPosts,
            likedReels,
            savedReels
        });
    } catch (error) {
        console.error("Vault fetch error:", error);
        res.status(500).json({ error: 'Failed to retrieve vault data' });
    }
});

// 14. USER PREFERENCES ROUTES (Protected by authenticateToken)
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

// 15. SERVER BINDING
// Finally, we tell the Express app to bind to the port and start listening for traffic.
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});