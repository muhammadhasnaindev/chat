// server/src/controllers/search.controller.js

/*
[PRO] Purpose: Unified search across users and public groups.
Context: Users by name/email (regex). Groups prefer MongoDB text search, then fall back to tokenized regex.
Edge cases: Empty query returns empty sets; text index may not exist → fallback path. Caps result sizes to protect DB.
Notes: Escapes user input for regex; keeps responses lean and stable for list UIs.
*/
import User from "../models/User.js";
import Chat from "../models/Chat.js";

function escapeRx(s = "") {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function unifiedSearch(req, res) {
  const raw = (req.query.q || "").trim();
  if (!raw) return res.json({ users: [], groups: [] });

  // Users: case-insensitive regex on name/email (exclude self if authenticated)
  const selfId = req.user?._id ? String(req.user._id) : null;
  const rx = new RegExp(escapeRx(raw), "i");

  const users = await User.find({
    ...(selfId ? { _id: { $ne: selfId } } : {}),
    $or: [{ name: rx }, { email: rx }],
  })
    .select("_id name email avatar")
    .limit(20)
    .lean();

  // Groups: try $text first; fallback to tokenized regex
  let groups = [];
  if (raw.length >= 2) {
    try {
      groups = await Chat.find({
        isGroup: true,
        "settings.isPublic": true,
        $text: { $search: raw },
      })
        .select("_id name description iconUrl participants settings")
        .sort({ score: { $meta: "textScore" } })
        .limit(20)
        .lean();
    } catch {
      // no text index, ignore
      groups = [];
    }
  }

  if (!groups.length) {
    const tokens = raw
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5) // guard against huge queries
      .map((t) => new RegExp(escapeRx(t), "i"));

    groups = await Chat.find({
      isGroup: true,
      "settings.isPublic": true,
      $and: tokens.map((rxTok) => ({
        $or: [{ name: { $regex: rxTok } }, { description: { $regex: rxTok } }],
      })),
    })
      .select("_id name description iconUrl participants settings createdAt")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
  }

  const shapedGroups = groups.map((g) => ({
    _id: g._id,
    name: g.name,
    description: g.description || "",
    iconUrl: g.iconUrl || "",
    isPublic: !!g.settings?.isPublic,
    membersCount: Array.isArray(g.participants) ? g.participants.length : 0,
  }));

  res.json({ users, groups: shapedGroups });
}
