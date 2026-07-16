// server/migrate-profile-pictures.js
//
// One-time manual migration (Phase 4a): finds every users.picture value that's still a
// base64 data URL (self-uploaded before the R2 switchover) and moves it to R2, rewriting
// the column to the resulting URL. OAuth-provider URLs and the ui-avatars.com fallback
// are left untouched. Run manually with `node migrate-profile-pictures.js` - never
// required/auto-run at server boot, unlike scraper.js.
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { uploadProfilePicture } = require('./r2');

const db = new sqlite3.Database('./data/glide.sqlite', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

db.all(`SELECT id, picture FROM users WHERE picture LIKE 'data:image%'`, [], async (err, rows) => {
    if (err) {
        console.error('Failed to query users:', err.message);
        process.exit(1);
    }

    console.log(`Found ${rows.length} base64 profile picture(s) to migrate.`);

    let migrated = 0;
    let failed = 0;

    for (const row of rows) {
        try {
            const url = await uploadProfilePicture(row.id, row.picture);
            await new Promise((resolve, reject) => {
                db.run(`UPDATE users SET picture = ? WHERE id = ?`, [url, row.id], (updateErr) => {
                    if (updateErr) reject(updateErr);
                    else resolve();
                });
            });
            migrated++;
            console.log(`  user ${row.id}: migrated -> ${url}`);
        } catch (e) {
            failed++;
            console.error(`  user ${row.id}: FAILED - ${e.message}`);
        }
    }

    console.log(`Done. Migrated ${migrated}, failed ${failed}, out of ${rows.length}.`);
    db.close();
});
