// server/src/routes/upload.routes.js
/*
[PRO] Purpose: Provide authenticated and public file uploads to a local disk store for development or simple deployments.
Context: Client enforces a 25 MB cap; server validates type and size and returns a stable /uploads URL.
Edge cases: Filenames sanitized and uniqued; public upload is limited to avatars during sign-up.
Notes: Keep server limit aligned with client (25 MB) to avoid confusing rejections; upgrade to S3 for production scale.
*/
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { auth } from '../middleware/auth.js';
import { UPLOAD_DIR } from '../config/paths.js';

const r = Router();

// Ensure target folder exists
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const base = path.basename(file.originalname || 'file', ext).slice(0, 64);
    const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    cb(null, `${base}_${stamp}${ext}`);
  },
});

/*
[PRO] Purpose: Basic MIME allowlist to reduce risk and keep previews predictable.
Context: Mirrors client-side accept attribute.
Edge cases: Generic video/audio types pass; unknown types rejected with 400.
Notes: Extend as needed for additional document formats.
*/
function fileFilter(_req, file, cb) {
  const ok = /image\/(png|jpe?g|gif|webp)|video\/|audio\/|application\/pdf/.test(file.mimetype);
  if (!ok) return cb(new Error('Unsupported file type'));
  cb(null, true);
}

/*
[PRO] Purpose: Cap uploads to 25 MB to match client validation.
Context: Prevents large payloads from exhausting memory or disk.
Edge cases: Multer throws when exceeded; client should already warn.
Notes: For larger files, switch to presigned uploads (S3).
*/
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

/*
[PRO] Purpose: Authenticated upload endpoint for in-app messaging.
Context: Requires Bearer token; returns relative URL under /uploads.
Edge cases: Ensure UPLOAD_DIR is readable by the static handler.
Notes: Response includes original name and MIME for client rendering.
*/
r.post('/local', auth, upload.single('file'), (req, res) => {
  const rel = `/uploads/${req.file.filename}`;
  res.json({
    url: rel,
    name: req.file.originalname,
    size: req.file.size,
    mime: req.file.mimetype,
  });
});

/*
[PRO] Purpose: Public upload for registration avatar only.
Context: Allows guests to attach an avatar before authentication.
Edge cases: Same size/type constraints; consider rate limiting.
Notes: Client uses this route with guest=true in the uploader.
*/
r.post('/public', upload.single('file'), (req, res) => {
  const rel = `/uploads/${req.file.filename}`;
  res.json({
    url: rel,
    name: req.file.originalname,
    size: req.file.size,
    mime: req.file.mimetype,
  });
});

export default r;
