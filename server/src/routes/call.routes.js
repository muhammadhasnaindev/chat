// server/src/routes/call.routes.js
/*
[PRO] Purpose: Minimal REST endpoints to list and log calls so the client can show history independent of WebSocket state.
Context: Call setup/signaling happens over Socket.IO; these endpoints persist audit entries and support history UI.
Edge cases: Logging must be idempotent per call; prefer server timestamps.
Notes: Keep payloads small; avoid leaking other users' data beyond chat membership.
*/
import { Router } from 'express';
import { auth as authMiddleware } from '../middleware/auth.js';
import { listMyCalls, logCallStart, logCallEnd } from '../controllers/call.controller.js';

const router = Router();
router.get('/', authMiddleware, listMyCalls);
router.post('/start', authMiddleware, logCallStart);
router.post('/end', authMiddleware, logCallEnd);

export default router;
