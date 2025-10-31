// server/src/routes/user.routes.js

/**
 * [PRO] Purpose: REST endpoints for user-facing profile data and privacy actions.
 * Context: Keep responses UI-ready with minimal fields, and avoid leaking sensitive attributes.
 * Edge cases: Missing query, self-block attempts, unknown user id -> handled with early returns and 4xx.
 * Notes: All routes are auth-protected; prefer lean reads for list/search endpoints to reduce memory.
 */

import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import User from '../models/User.js';

const r = Router();

/**
 * [PRO] Purpose: Return the caller’s own safe profile snapshot.
 * Context: Client needs a consistent shape for header/profile screens after login.
 * Edge cases: None; uses req.user injected by auth middleware.
 * Notes: Keep fields stable; adding here affects multiple clients.
 */
r.get('/me', auth, async (req, res) => {
  try {
    return res.json({
      id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      avatar: req.user.avatar,
      about: req.user.about,
      lastSeen: req.user.lastSeen,
      emailVerified: req.user.emailVerified,
    });
  } catch (e) {
    console.error('USER /me GET error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

/**
 * [PRO] Purpose: Let the user update visible profile fields (name, about, avatar).
 * Context: Partial updates avoid overwriting unset properties and reduce client coupling.
 * Edge cases: Undefined inputs should not null-out existing values; update only provided fields.
 * Notes: Save once to minimize write contention; response echoes new canonical profile shape.
 */
r.patch('/me', auth, async (req, res) => {
  try {
    const { name, about, avatar } = req.body || {};

    if (name !== undefined) req.user.name = name;
    if (about !== undefined) req.user.about = about;
    if (avatar !== undefined) req.user.avatar = avatar; // avatar is provided as URL from /api/upload

    await req.user.save();

    return res.json({
      message: 'Updated',
      user: {
        id: req.user._id,
        email: req.user.email,
        name: req.user.name,
        avatar: req.user.avatar,
        about: req.user.about,
        lastSeen: req.user.lastSeen,
        emailVerified: req.user.emailVerified,
      },
    });
  } catch (e) {
    console.error('USER /me PATCH error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

/**
 * [PRO] Purpose: Lightweight lookup for users by name or email for “start chat / add to group”.
 * Context: Client-side typeahead should be fast and avoid large payloads.
 * Edge cases: Empty query returns empty array; self should be excluded; regex must be escaped.
 * Notes: Add .lean() to reduce overhead; cap results to avoid heavy lists.
 */
r.get('/search', auth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);

    // escape regex special chars to prevent injection-like patterns
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(esc, 'i');

    const users = await User.find({
      _id: { $ne: req.user._id }, // exclude self
      $or: [{ name: regex }, { email: regex }],
    })
      .select('_id name email avatar')
      .limit(20)
      .lean();

    return res.json(users);
  } catch (e) {
    console.error('USER search error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

/**
 * [PRO] Purpose: Public profile view for another user (safe, read-only subset).
 * Context: Chat profile sidebar needs a concise dataset independent of private fields.
 * Edge cases: Unknown user id -> 404; ensure only non-sensitive fields are returned.
 * Notes: .lean() for lower overhead; keep fields aligned with client expectations.
 */
r.get('/:id/public', auth, async (req, res) => {
  try {
    const u = await User.findById(req.params.id)
      .select('name about avatar lastSeen')
      .lean();

    if (!u) return res.status(404).json({ message: 'Not found' });
    return res.json(u);
  } catch (e) {
    console.error('USER public error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

/**
 * [PRO] Purpose: Block a user to prevent direct messages and hide presence.
 * Context: DM privacy needs a simple per-user list; we store ids in caller.blocked.
 * Edge cases: Blocking self is invalid; duplicate adds should be idempotent.
 * Notes: $addToSet keeps it idempotent; response intentionally minimal.
 */
r.post('/block/:id', auth, async (req, res) => {
  try {
    if (String(req.user._id) === String(req.params.id)) {
      return res.status(400).json({ message: 'Cannot block self' });
    }

    await User.updateOne(
      { _id: req.user._id },
      { $addToSet: { blocked: req.params.id } }
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error('USER block error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

/**
 * [PRO] Purpose: Remove a user from the caller’s block list.
 * Context: Symmetric with block; used from profile actions.
 * Edge cases: Removing a non-existent entry should still succeed (idempotent).
 * Notes: $pull handles absence gracefully; minimal response body for UI.
 */
r.post('/unblock/:id', auth, async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.user._id },
      { $pull: { blocked: req.params.id } }
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('USER unblock error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

export default r;
