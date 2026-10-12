// Shrinks uploaded images and videos to save storage.
// Images are re-encoded in place right away; videos are transcoded in the background.
// A compressed copy is only kept when it is actually smaller than the original.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let sharp = null; try { sharp = require('sharp'); } catch { /* optional */ }
let ffmpegPath = null; try { ffmpegPath = require('ffmpeg-static'); if (ffmpegPath && !fs.existsSync(ffmpegPath)) ffmpegPath = null; } catch { /* optional */ }

const MAX_IMAGE = Number(process.env.MEDIA_MAX_IMAGE || 2560);
const IMAGE_QUALITY = Number(process.env.MEDIA_IMAGE_QUALITY || 82);
const VIDEO_CRF = String(process.env.MEDIA_VIDEO_CRF || 28);
const MIN_BYTES = 150 * 1024; // smaller files aren't worth touching
const enabled = () => process.env.MEDIA_COMPRESS !== '0';

const isImage = (mime) => /^image\/(jpeg|png|webp)$/.test(mime || '');
const isVideo = (mime) => /^video\//.test(mime || '');

/** Re-encodes an image file in place. Returns the new size, or null when left alone. */
async function compressImageFile(file, mime) {
  if (!sharp) return null;
  const before = (await fs.promises.stat(file)).size;
  if (before < MIN_BYTES) return null;
  let img = sharp(file, { failOn: 'none' }).rotate();
  const meta = await img.metadata();
  if (meta.pages > 1) return null; // leave animations alone
  if ((meta.width || 0) > MAX_IMAGE || (meta.height || 0) > MAX_IMAGE) img = img.resize({ width: MAX_IMAGE, height: MAX_IMAGE, fit: 'inside', withoutEnlargement: true });
  if (mime === 'image/png') img = img.png({ compressionLevel: 9, palette: true, quality: 90, effort: 7 });
  else if (mime === 'image/webp') img = img.webp({ quality: IMAGE_QUALITY });
  else img = img.jpeg({ quality: IMAGE_QUALITY, mozjpeg: true });
  const buf = await img.toBuffer();
  if (buf.length >= before * 0.95) return null;
  await fs.promises.writeFile(file, buf);
  return buf.length;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.split('\n').slice(-3).join(' ')}`))));
  });
}

/** Transcodes a video to H.264/AAC MP4, max 1080p. Returns { size, fileName } or null. */
async function compressVideoFile(dir, fileName) {
  if (!ffmpegPath) return null;
  const src = path.join(dir, fileName);
  const before = (await fs.promises.stat(src)).size;
  if (before < MIN_BYTES) return null;
  const outName = `${path.basename(fileName, path.extname(fileName))}-c.mp4`;
  const out = path.join(dir, outName);
  try {
    await runFfmpeg(['-y', '-i', src, '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', VIDEO_CRF, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
  } catch (e) { fs.promises.unlink(out).catch(() => {}); throw e; }
  const after = (await fs.promises.stat(out)).size;
  if (after >= before * 0.95) { await fs.promises.unlink(out).catch(() => {}); return null; }
  return { size: after, fileName: outName };
}

// One video at a time so a burst of uploads doesn't starve the server.
let queue = Promise.resolve();

/**
 * Compresses one Attachment row's file. Images are awaited; videos are queued.
 * Never throws: failures just mark the row and keep the original.
 */
async function compressAttachment(row, dir, { onDone } = {}) {
  if (!enabled() || !row) return row;
  try {
    if (isImage(row.mime) && sharp) {
      const size = await compressImageFile(path.join(dir, row.fileName), row.mime);
      if (size) { row.originalSize = row.size; row.size = size; row.compression = 'done'; } else row.compression = 'skipped';
      await row.save();
    } else if (isVideo(row.mime) && ffmpegPath) {
      row.compression = 'pending'; await row.save();
      queue = queue.then(async () => {
        try {
          const r = await compressVideoFile(dir, row.fileName);
          if (!(await row.reload().then(() => true).catch(() => false))) { if (r) fs.promises.unlink(path.join(dir, r.fileName)).catch(() => {}); return; }
          const srcName = row.fileName;
          if (r) {
            row.originalSize = row.size; row.size = r.size; row.fileName = r.fileName; row.mime = 'video/mp4';
            if (!/\.mp4$/i.test(row.originalName)) row.originalName = `${path.basename(row.originalName, path.extname(row.originalName))}.mp4`;
            row.compression = 'done';
          } else row.compression = 'skipped';
          await row.save();
          if (r && srcName !== r.fileName) fs.promises.unlink(path.join(dir, srcName)).catch(() => {});
        } catch (e) {
          console.warn('[media] video compression failed:', e.message);
          row.compression = 'failed'; await row.save().catch(() => {});
        }
        if (onDone) onDone(row);
      });
    }
  } catch (e) {
    console.warn('[media] compression failed:', e.message);
    row.compression = 'failed'; await row.save().catch(() => {});
  }
  return row;
}

/** Compresses a list of rows (images in sequence, videos queued). */
async function compressAll(rows, dir, opts) {
  for (const r of rows || []) await compressAttachment(r, dir, opts);
  return rows;
}

/** Waits for queued video jobs (used by tests and shutdown). */
const drain = () => queue;

module.exports = { compressAttachment, compressAll, compressImageFile, drain, available: () => ({ images: !!sharp, videos: !!ffmpegPath }) };
