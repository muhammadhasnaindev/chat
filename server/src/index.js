// server/index.js
/*
[PRO] Purpose: Bootstrap the HTTPS API server, wire core middleware, mount routes, serve uploads, and attach Socket.IO.
Context: The app moved from mixed HTTP/HTTPS to HTTPS-only to avoid mixed content and simplify client configuration.
Edge cases: Missing TLS certs halts startup; multiple CORS origins supported; empty Origin (Postman/curl) allowed.
Notes: Keep uploads on-disk under server/uploads; pass explicit origin list into Socket.IO for parity with Express CORS.
*/
import express from 'express';
import https from 'https';
import fs from 'fs';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';

import { env } from './config/env.js';
import { connectDB } from './config/db.js';

import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import chatRoutes from './routes/chat.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import searchRoutes from './routes/search.routes.js';
import callRoutes from './routes/call.routes.js';
import { initSocket } from './sockets/io.js';
import { UPLOAD_DIR } from './config/paths.js';

const app = express();

/* Purpose: quick visibility into SMTP configuration at boot.
   Context: helps confirm .env is loaded and transport will be built as expected.
   Edge cases: undefined HOST falls back to nodemailer's default per mailer.js.
   Notes: avoid logging credentials. */
console.log('SMTP host:', env.SMTP?.HOST || '(default smtp.gmail.com)');

/* Purpose: configure CORS with a whitelist that supports comma-separated env values.
   Context: browsers enforce CORS while tools like curl/Postman often omit Origin.
   Edge cases: unknown Origin gets a descriptive CORS error; falsy Origin is allowed. */
const allowed = (env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // allow non-browser clients
      if (allowed.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for ${origin}`));
    },
    credentials: true,
  })
);

/* Purpose: parse JSON safely and observe requests for debugging.
   Context: typical API defaults; 10mb supports small media metadata posts.
   Edge cases: oversize bodies rejected by Express; morgan kept in dev format. */
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

/* Purpose: serve user-uploaded files from a stable path.
   Context: client references /uploads/<key>; create the folder if missing.
   Edge cases: nested dirs created recursively; ensure read-only static. */
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

/* Purpose: very lightweight health probe.
   Context: useful for load balancers / uptime checks over HTTPS.
   Edge cases: none; returns plain text. */
app.get('/', (_req, res) => res.send('API OK (HTTPS)'));

/* Purpose: mount versionless API routes for simplicity.
   Context: v1 not required yet; can prefix later if APIs grow.
   Edge cases: order matters only for conflicting prefixes (none here). */
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/calls', callRoutes);

/* Purpose: connect to Mongo before accepting traffic.
   Context: avoids accepting requests that will fail due to missing DB.
   Edge cases: failed connect should crash the process to allow restarts. */
await connectDB();

/* Purpose: run HTTPS only with local PEM/KEY files for dev/staging.
   Context: prevents mixed content errors for the web client and PWA.
   Edge cases: absent certs → exit with clear message; change paths as needed. */
const CERT_PATH = path.join(process.cwd(), 'certs'); // <repo>/server/certs
const certFile = path.join(CERT_PATH, '10.16.151.138+2.pem');
const keyFile = path.join(CERT_PATH, '10.16.151.138+2-key.pem');

if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
  console.error(' HTTPS certs not found in server/certs. Place your PEM & KEY there.');
  process.exit(1);
}

const creds = {
  cert: fs.readFileSync(certFile),
  key: fs.readFileSync(keyFile),
};

const server = https.createServer(creds, app);

/* Purpose: attach Socket.IO with the same origin policy used by Express.
   Context: some deployments require multiple origins; arrays are supported.
   Edge cases: if env value is empty, callers may rely on a reverse proxy. */
initSocket(server, allowed);

/* Purpose: listen on all interfaces to support LAN IP testing.
   Context: useful for device testing on the same network.
   Edge cases: ports in use will throw; docker/pm2 should handle restarts. */
server.listen(env.PORT, '0.0.0.0', () => {
  console.log(`HTTPS server on https://0.0.0.0:${env.PORT}`);
  console.log('Allowed CORS origins:', allowed);
});
