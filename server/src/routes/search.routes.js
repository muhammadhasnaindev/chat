// server/src/routes/search.routes.js
/*
[PRO] Purpose: Unified search endpoint for users and public groups behind auth.
Context: Reduces client round trips by aggregating results server-side with simple shaping.
Edge cases: Empty queries return fast; rate-limit at gateway if abused.
Notes: Keep results capped to small pages; controller handles text index fallback.
*/
import { Router } from 'express';
import { unifiedSearch } from '../controllers/search.controller.js';
import { auth as authMiddleware } from '../middleware/auth.js';

const router = Router();
router.get('/', authMiddleware, unifiedSearch);

export default router;
