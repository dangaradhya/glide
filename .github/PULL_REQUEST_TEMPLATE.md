## What does this PR do?

<!-- Brief description of the change -->

## Checklist

- [ ] `npm run build` passes locally in `dashboard/` (CI checks this too, but verify before pushing)
- [ ] If this PR changes anything in `server/index.js`'s `db.run(CREATE TABLE ...)` blocks or adds new columns: I used `CREATE TABLE IF NOT EXISTS` / additive `ALTER TABLE` only. SQLite has no migration tooling here — there's no rollback path for a destructive schema change once it's deployed against the live `glide.sqlite` file.
- [ ] If this PR changes a page's safe-area/notch handling (`--app-safe-top`, `--app-safe-bottom`, `--app-banner-height`): tested on an actual native Android/iOS build, not just the web preview — these two environments have historically diverged (see commit history around 2026-07-12/13).
