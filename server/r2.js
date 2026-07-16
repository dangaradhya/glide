// server/r2.js
//
// Cloudflare R2 (S3-compatible object storage) integration for profile pictures.
// Replaces storing raw base64 image data directly in the users.picture SQLite column -
// see the Phase 4a discussion for the full rationale (DB bloat, every users-join dragging
// megabytes of base64 text along with it).
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');

const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;

// Accepts a data URL (e.g. "data:image/png;base64,...") as produced by the frontend's
// FileReader.readAsDataURL(), resizes it down to a fixed small square (matches what a
// circular avatar ever actually needs on screen), and uploads it to R2 under a stable
// per-user key so re-uploads simply overwrite the previous picture rather than
// accumulating orphaned objects.
async function uploadProfilePicture(userId, dataUrl) {
    const matches = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
    if (!matches) {
        throw new Error('Expected a base64 image data URL');
    }

    const buffer = Buffer.from(matches[1], 'base64');
    const resized = await sharp(buffer)
        .resize(512, 512, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toBuffer();

    const key = `profile-pics/${userId}.jpg`;
    await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: resized,
        ContentType: 'image/jpeg',
    }));

    // Cache-bust: the key never changes on re-upload, so without a query param the
    // browser (and any CDN edge) would keep serving the old cached picture indefinitely.
    return `${PUBLIC_URL}/${key}?v=${Date.now()}`;
}

module.exports = { uploadProfilePicture };
