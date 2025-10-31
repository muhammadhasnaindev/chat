// server/src/controllers/user.controller.js

/*
[PRO] Purpose: User profile read/update, user search, and web push subscription.
Context: Keeps responses small for UI; avoids leaking sensitive fields.
Edge cases: Empty updates are no-ops; duplicate push endpoints ignored; self excluded from search.
Notes: Save only provided fields; consider adding rate limits to search to protect DB.
*/
import User from "../models/User.js";

/*
[PRO] Purpose: Return the current authenticated user's public profile fields.
Context: Used to prefill settings/profile screens.
Edge cases: None—req.user is set by auth middleware.
Notes: Keep payload minimal and stable.
*/
export async function me(req, res) {
  const u = req.user;
  res.json({
    id: u._id,
    email: u.email,
    name: u.name,
    avatar: u.avatar,
    about: u.about,
    lastSeen: u.lastSeen,
  });
}

/*
[PRO] Purpose: Update selected profile fields.
Context: Partial updates; server trusts auth middleware and saves minimal fields.
Edge cases: Undefined fields are ignored; empty strings allowed.
Notes: Consider validation (length, URL) upstream if needed.
*/
export async function updateProfile(req, res) {
  const { name, about, avatar } = req.body;
  if (name !== undefined) req.user.name = name;
  if (about !== undefined) req.user.about = about;
  if (avatar !== undefined) req.user.avatar = avatar;
  await req.user.save();
  res.json({
    message: "Updated",
    user: {
      id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      avatar: req.user.avatar,
      about: req.user.about,
      lastSeen: req.user.lastSeen,
    },
  });
}

/*
[PRO] Purpose: Lightweight user search by name/email for mentions or DM lookup.
Context: Case-insensitive regex; excludes the requester.
Edge cases: Empty query → []; caps result size.
Notes: Escape regex to avoid special-character surprises.
*/
export async function searchUsers(req, res) {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(esc, "i");
  const users = await User.find({
    _id: { $ne: req.user._id },
    $or: [{ name: regex }, { email: regex }],
  })
    .select("name email avatar")
    .limit(20)
    .lean();
  res.json(users);
}

/*
[PRO] Purpose: Store a web push subscription for notifications.
Context: Client posts subscription JSON; we dedupe by endpoint.
Edge cases: Missing/invalid shape → 400; duplicate endpoint no-ops.
Notes: Keep array small; consider TTL cleanup in a cron.
*/
export async function setPushSubscription(req, res) {
  const sub = req.body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ message: "Invalid subscription" });
    }
  if (!req.user.pushSubscriptions) req.user.pushSubscriptions = [];
  const exists = req.user.pushSubscriptions.some((s) => s.endpoint === sub.endpoint);
  if (!exists) {
    req.user.pushSubscriptions.push(sub);
    await req.user.save();
  }
  res.json({ message: "Subscribed" });
}
