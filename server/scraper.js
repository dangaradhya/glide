// 1. IMPORTS & CONFIGURATION
require('dotenv').config(); // Loads your GEMINI_API_KEY and YOUTUBE_API KEY from the .env file
const cheerio = require('cheerio');
const Parser = require('rss-parser');
// Import node-cron for Strategic Pacing (Token Defense)
const cron = require('node-cron'); 
const { GoogleGenAI } = require('@google/genai'); 

const parser = new Parser();
// Initialize the Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// YouTube API key for the Reels pipeline, also stored securely in .env
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// News sources for the main pipeline (e.g., Sky Sports, ESPN)
const NEWS_SOURCES = [
    { name: 'SkySports', url: 'https://www.skysports.com/rss/12040' },
    { name: 'ESPN', url: 'https://www.espn.com/espn/rss/news' }
];

// Targeting the uploads playlist of 10 Youtube channels
const REELS_SOURCES = [
    { name: 'ESPN', playlistId: 'UUiWLfSweyRNmLpgEHekhoAg' },
    { name: 'CBS Sports Golazo', playlistId: 'UUET00YnetHT7tOpu12v8jxg' },
    { name: 'UFC', playlistId: 'UUvgfXK4nTYKudb0rFR6noLA' },
    { name: 'NBA', playlistId: 'UUWJ2lWNubArHWmf3FIHbfcQ' },
    { name: 'Sky Sports Premier League', playlistId: 'UUNAf1k0yIjyGu3k9BwAg3lg' },
    { name: 'The Ring Magazine', playlistId: 'UU8ybHJltwhtpk0cFKU4G8kQ' },
    { name: 'Bundesliga', playlistId: 'UU6UL29enLNe4mqwTfAyeNuw' },
    { name: 'Serie A', playlistId: 'UUBJeMCIeLQos7wacox4hmLQ' },
    { name: 'TSN', playlistId: 'UU--i2rV5NCxiEIPefr3l-zQ' },
    { name: 'House of Highlights', playlistId: 'UUqQo7ewe87aYAe7ub5UqXMw' }
];

// Dynamically grab Render's port, fallback to 3000 locally
const PORT = process.env.PORT || 3000;

// This is the URL of the Express API endpoint where we will POST the formatted articles to be saved in the database
const GLIDE_API_URL = `http://127.0.0.1:${PORT}/api/posts`;
// The URL of our new Deduplication Gate route on the Express Server
const CHECK_URL = `http://127.0.0.1:${PORT}/api/posts/check`;

// URLs for the Reels pipeline
const REELS_API_URL = `http://127.0.0.1:${PORT}/api/reels`;
const REELS_CHECK_URL = `http://127.0.0.1:${PORT}/api/reels/check`;

// 2. The "Is it a Short?" Network Trick
// This pings YouTube's servers. If YouTube redirects the /shorts/ URL to a standard /watch/ URL, it's a long-form video.
async function isYouTubeShort(videoId) {
    // We make a HEAD request to the /shorts/ URL, which is a lightweight way to check if the video exists in that format without downloading the whole page.
    try {
        const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
            method: 'HEAD',
            redirect: 'manual' // We tell node.js NOT to follow redirects so we can read the 300-level status code
        });
        // A status of 200 means the /shorts/ URL is valid and it is a vertical video!
        return res.status === 200;
    } catch (error) {
        return false;
    }
}

// 3. THE AI REWRITE FUNCTION
// This function takes the boring RSS text and uses Gemini to transform it into strict JSON.
// Handles an ARRAY of articles for Batch Processing (Token Defense).
async function batchFormatWithGemini(articlesArray) {
    const prompt = `
    You are Fabrizio Romano, the world's most energetic sports journalist.
    Review the following JSON array of raw sports articles.
    Extract the core facts for each and rewrite it as a short, punchy social media update. 
    
    RAW ARTICLES:
    ${JSON.stringify(articlesArray)}
    
    Return ONLY a valid JSON ARRAY containing objects with exact following keys (no markdown formatting, no code blocks):
    - sport_category: (e.g., "Football", "Golf", "Formula 1")
    - headline: (A punchy, exciting headline)
    - content: (The rewritten summary, max 2 sentences. Make it sound exciting)
    - excitement_level: (A number from 1 to 10)
    - url: (You MUST include the exact original URL provided in the raw data)
    `;

    try {
        // We call the Gemini Flash model (fast and cheap, perfect for data pipelines)
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: prompt,
        });

        // The AI returns a string, so we parse it into a native JavaScript object
        const cleanText = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);
    } catch (error) {
        console.error("⚠️ AI Formatting Error:", error.message);
        // Return an empty array if the AI fails, acting as error handling for batches
        return []; 
    }
}

// 4. THE IMAGE SCRAPER FUNCTION
async function extractOgImage(articleUrl) {

    // We fetch the article's HTML and use Cheerio to look for the Open Graph image tag, which is commonly used for social media previews. 
    // If we find it, we return that URL. If not, we return a cool fallback image URL.
    try {
        const response = await fetch(articleUrl);
        const html = await response.text();
        
        // Load the HTML into Cheerio so we can query it like the browser DOM
        const $ = cheerio.load(html);
        
        // Look for the Open Graph image tag
        const ogImage = $('meta[property="og:image"]').attr('content');
        
        // Return the image, or a cool fallback image if the article has none
        return ogImage || 'https://placehold.co/1200x630/111827/a855f7?text=GLIDE&font=Montserrat';
    } catch (error) {
        console.error(`Failed to fetch image for ${articleUrl}:`, error.message);
        return 'https://placehold.co/1200x630/111827/a855f7?text=GLIDE&font=Montserrat';
    }
}

// 5. THE MAIN INGESTION LOOP
async function runIngestionPipeline() {
    // Added a timestamp to the log so we can track the cron jobs
    console.log(`\n📡 [${new Date().toLocaleTimeString()}] Fetching live sports news...`);
    
    // Multi-Source Scaling - The Gather Phase
    let allTopArticles = [];
    
    // We loop through each of our sources (SkySports, ESPN, etc.)
    for (const source of NEWS_SOURCES) {
        try {
            console.log(`   -> Fetching from ${source.name}...`);
            const feed = await parser.parseURL(source.url);
            // Grab the top 7 articles from THIS specific source
            const topArticles = feed.items.slice(0, 7); 
            // Combine them into our master array
            allTopArticles = allTopArticles.concat(topArticles);
        } catch (err) {
            console.error(`   ⚠️ Failed to fetch from ${source.name}:`, err.message);
        }
    }

    console.log(`\n📊 Gathered a total of ${allTopArticles.length} articles. Passing to the Gatekeeper...`);

    // Array to hold only the articles that pass the gate
    const newArticlesToProcess = [];

    // DEFENSE 1 - THE DEDUPLICATION GATE
    // We loop through each article and check the database BEFORE spending AI tokens
    for (const article of allTopArticles) {

        // For each article, we send a POST request to our Express server's /api/posts/check route
        try {
            const checkRes = await fetch(CHECK_URL, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    // Added Scraper Key for authentication
                    'x-scraper-key': process.env.SCRAPER_KEY
                },
                body: JSON.stringify({ url: article.link })
            });
            const { exists } = await checkRes.json();

            if (!exists) {
                // If the article is NOT in the DB, add it to our batch
                newArticlesToProcess.push({ 
                    title: article.title, 
                    // CHANGE ADDED: ESPN fallback for contentSnippet
                    summary: article.contentSnippet || article.content, 
                    url: article.link 
                });
            }
        } catch (err) {
            console.error(`🔌 Gate check failed for ${article.title}`);
        }
    }

    // If the array is empty, exit early and save tokens!
    if (newArticlesToProcess.length === 0) {
        console.log(`🛡️ Gate closed: All ${allTopArticles.length} articles already in database. Zero AI tokens consumed.`);
        return; 
    }

    console.log(`\n🧠 Sending optimized batch of ${newArticlesToProcess.length} new articles to AI...`);

    // Pass data to Gemini (Now passing the filtered batch array)
    const aiFormattedPosts = await batchFormatWithGemini(newArticlesToProcess);
    
    if (aiFormattedPosts && aiFormattedPosts.length > 0) {
        console.log(`✅ AI successfully formatted the batch! Saving to database...`);
        
        // Loop through the returned AI array to save each post individually
        for (const post of aiFormattedPosts) {
            
            // Fetch the image directly from the source article!
            const articleImageUrl = await extractOgImage(post.url);

            // Add it to the payload alongside Gemini's data
            const payload = {
                sport_category: post.sport_category,
                headline: post.headline,
                content: post.content,
                excitement_level: post.excitement_level,
                url: post.url,
                image_url: articleImageUrl
            };

            // Send the AI's output to our Express Server via an HTTP POST request
            // This is the built-in Node.js fetch API 
            try {
                const dbResponse = await fetch(GLIDE_API_URL, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-scraper-key': process.env.SCRAPER_KEY
                    },
                    // We now stringify the new 'payload' object instead of just 'post'
                    body: JSON.stringify(payload) 
                });

                if (dbResponse.ok) {
                    console.log(`💾 Successfully saved to GLIDE Database: ${post.headline}`);
                } else {
                    console.error(`❌ Failed to save to database. Is the server running?`);
                }
            } catch (networkError) {
                console.error(`🔌 Network Error: Could not reach Express server.`, networkError.message);
            }
        }
    } else {
        console.log(`⚠️ AI returned an empty or invalid batch.`);
    }
    console.log(`\n🏁 Ingestion cycle complete!`);
}

// 6. THE REELS PIPELINE 
async function runReelsPipeline() {
    // Similar structure to the main pipeline, but focused on fetching YouTube video data
    // and saving it to a separate "reels" collection in the database.
    console.log(`\n🎬 [${new Date().toLocaleTimeString()}] Fetching live video reels...`);
    
    // Trackers for our new Deduplication Gatekeeper
    let totalReelsGathered = 0;
    let newReelsSaved = 0;

    // We loop through each YouTube channel source
    for (const source of REELS_SOURCES) {
        try {
            console.log(`   -> Fetching videos from ${source.name}...`);

            // The official YouTube API endpoint requesting 10 videos from the Uploads playlist
            const apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${source.playlistId}&maxResults=10&key=${YOUTUBE_API_KEY}`;
            
            // Fetch the data from YouTube's API
            const response = await fetch(apiUrl);
            const data = await response.json();

            // Error handling in case the API key is missing or quota is exceeded
            if (data.error) {
                console.error(`   ⚠️ API Error for ${source.name}:`, data.error.message);
                continue;
            }
            
            // We extract the list of videos from the API response
            const topVideos = data.items;
            if (!topVideos) continue;

            totalReelsGathered += topVideos.length;

            for (const video of topVideos) {
                // The JSON structure from YouTube's API is slightly different from RSS
                const videoId = video.snippet.resourceId.videoId;
                const title = video.snippet.title;

                if (!videoId) continue;

                // DEFENSE: Check if video is already in database, which prevents us from saving duplicates
                const checkRes = await fetch(REELS_CHECK_URL, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-scraper-key': process.env.SCRAPER_KEY
                    },
                    body: JSON.stringify({ video_id: videoId })
                });
                
                // We await the response and parse the JSON to see if the video already exists in our database
                const { exists } = await checkRes.json();

                // If it exists, skip the rest of the loop entirely!
                if (exists) {
                    continue; 
                }

                //  New video - validate that this is actually a vertical short
                const isShort = await isYouTubeShort(videoId);
                if (!isShort) {
                    // We skip it and move to the next iteration of the loop
                    continue; 
                }

                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Save directly to the database by POSTing to our Express server's /api/reels endpoint
                const payload = {
                    video_id: videoId,
                    title: title,
                    channel_name: source.name
                };
                
                const dbResponse = await fetch(REELS_API_URL, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-scraper-key': process.env.SCRAPER_KEY
                    },
                    body: JSON.stringify(payload)
                });
                
                // If the response is OK, we increment our newReelsSaved counter and log the success. If not, we log an error.
                if (dbResponse.ok) {
                    newReelsSaved++;
                    console.log(`   💾 Saved New Reel: ${title}`);
                }
            }
        } catch (err) {
            console.error(`   ⚠️ Failed to fetch reels from ${source.name}:`, err.message);
        }
    }

    // Deduplication Gatekeeper log for Reels
    if (newReelsSaved === 0) {
        console.log(`🛡️ Gate closed: All ${totalReelsGathered} reels already in database.`);
    }

    console.log(`🏁 Reels ingestion cycle complete!`);
}

// DEFENSE 3 - STRATEGIC PACING
// Execute both pipeline once immediately on startup...
runIngestionPipeline();
runReelsPipeline();

// ...then schedule it to run automatically every 1 hour in the background
cron.schedule('0 * * * *', () => {
    runIngestionPipeline();
    runReelsPipeline();
});