// server/src/controllers/chat.controller.js

/*
[PRO] Purpose: Chat + message endpoints for list, read, send, membership, and public groups.
Context: Sockets drive live UX, but REST remains for initial loads & fallbacks.
Edge cases: Privacy around unread counts; guard group admin actions; hydrate replyTo for UI.
Notes: .lean() where possible; use small projections; keep preview strings plain (no emoji).
*/
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";

/*
[PRO] Purpose: Find existing DM or create a new one between me and target.
Context: Enforce two-participant constraint with $all + $size.
Edge cases: Parallel creations are rare; unique index on (isGroup=false, participants set) is ideal.
Notes: Populate minimal fields for left-pane list.
*/
export async function getOrCreateDirectChat(req, res) {
  const { userId } = req.params;
  const me = req.user._id;

  let chat = await Chat.findOne({
    isGroup: false,
    participants: { $all: [me, userId], $size: 2 },
  });
  if (!chat) chat = await Chat.create({ participants: [me, userId] });

  const full = await Chat.findById(chat._id).populate(
    "participants",
    "name email avatar"
  );
  res.json(full);
}

/*
[PRO] Purpose: Return user’s chats enriched with last message + unread count.
Context: Two small aggregations (last per chat, unread per chat) then merge in memory.
Edge cases: Empty state; lastMessageAt falls back to created/updated timestamps.
Notes: Preview text uses plain labels: Photo/Video/Audio/File (no emoji).
*/
export async function listMyChats(req, res) {
  const me = req.user._id;

  const base = await Chat.find({ participants: me })
    .select("-__v")
    .populate("participants", "name email avatar")
    .lean();

  if (!base.length) return res.json([]);

  const chatIds = base.map((c) => c._id);

  const lastMsgs = await Message.aggregate([
    { $match: { chat: { $in: chatIds } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$chat", doc: { $first: "$$ROOT" } } },
    {
      $project: {
        _id: 0,
        chat: "$_id",
        msg: {
          _id: "$doc._id",
          type: "$doc.type",
          text: "$doc.text",
          mediaName: "$doc.mediaName",
          sender: "$doc.sender",
          createdAt: "$doc.createdAt",
        },
      },
    },
  ]);
  const lastMap = new Map(lastMsgs.map((x) => [String(x.chat), x.msg]));

  const unreadAgg = await Message.aggregate([
    {
      $match: {
        chat: { $in: chatIds },
        sender: { $ne: me },
        readBy: { $ne: me },
      },
    },
    { $group: { _id: "$chat", count: { $sum: 1 } } },
  ]);
  const unreadMap = new Map(unreadAgg.map((x) => [String(x._id), x.count]));

  const previewFor = (m) => {
    if (!m) return "";
    if (m.type === "text") return m.text || "";
    if (m.type === "image") return "Photo";
    if (m.type === "video") return "Video";
    if (m.type === "audio") return "Audio";
    return m.mediaName ? `File: ${m.mediaName}` : "File";
  };

  const enriched = base.map((c) => {
    const lm = lastMap.get(String(c._id)) || null;
    const unread = unreadMap.get(String(c._id)) || 0;
    const lastMessageAt = lm?.createdAt || c.lastMessageAt || c.updatedAt;

    return {
      ...c,
      lastMessage: lm
        ? {
            _id: lm._id,
            type: lm.type,
            text: lm.text,
            mediaName: lm.mediaName,
            sender: lm.sender,
            createdAt: lm.createdAt,
            preview: previewFor(lm),
          }
        : null,
      lastMessageAt,
      unreadCount: unread,
    };
  });

  enriched.sort(
    (a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt)
  );
  res.json(enriched);
}

/*
[PRO] Purpose: Fetch messages for a chat, oldest-first.
Context: UI needs replyTo.sender for readable reply headers.
Edge cases: None; if you add pagination, sort+limit with a cursor.
Notes: Keep projection small; .lean() for throughput.
*/
export async function getMessages(req, res) {
  const { chatId } = req.params;
  const msgs = await Message.find({ chat: chatId })
    .sort({ createdAt: 1 })
    .populate({
      path: "replyTo",
      select: "_id type text mediaName sender",
      populate: { path: "sender", select: "_id name avatar" },
    })
    .lean();
  res.json(msgs);
}

/*
[PRO] Purpose: REST send (sockets are primary); keeps feature parity for API tools.
Context: Touch chat.lastMessageAt for list ordering.
Edge cases: replyTo optional; media fields optional.
Notes: Populate replyTo.sender for immediate client render.
*/
export async function sendMessage(req, res) {
  const { chatId } = req.params;
  const {
    text,
    type,
    mediaUrl,
    mediaName,
    mediaSize,
    mediaDuration,
    replyToId,
  } = req.body;

  const msg = await Message.create({
    chat: chatId,
    sender: req.user._id,
    text,
    type,
    mediaUrl,
    mediaName,
    mediaSize,
    mediaDuration,
    status: "sent",
    replyTo: replyToId || undefined,
  });

  await Chat.findByIdAndUpdate(chatId, {
    lastMessageAt: new Date(),
    updatedAt: new Date(),
  });

  const hydrated = await msg.populate({
    path: "replyTo",
    select: "_id type text mediaName sender",
    populate: { path: "sender", select: "_id name avatar" },
  });

  res.json(hydrated);
}

/*
[PRO] Purpose: Report DM block flags for current user vs. the other participant.
Context: Client gates composer and shows reasons.
Edge cases: Groups always false/false; missing other => false/false.
Notes: Relies on User.blocked list stored on each user doc.
*/
export async function getChatStatus(req, res) {
  const { chatId } = req.params;
  const me = req.user._id;

  const chat = await Chat.findById(chatId).populate("participants", "_id blocked");
  if (!chat) return res.status(404).json({ message: "Chat not found" });

  if (chat.isGroup) return res.json({ blockedByMe: false, blockedMe: false });

  const other = chat.participants.find((u) => String(u._id) !== String(me));
  let blockedByMe = false;
  let blockedMe = false;

  if (other) {
    const meDoc = chat.participants.find((u) => String(u._id) === String(me));
    const myBlocks = new Set((meDoc?.blocked || []).map(String));
    const theirBlocks = new Set((other?.blocked || []).map(String));
    blockedByMe = myBlocks.has(String(other._id));
    blockedMe = theirBlocks.has(String(me));
  }
  res.json({ blockedByMe, blockedMe });
}

/*
[PRO] Purpose: Fetch full chat with participants/admins/creator.
Context: Client needs admin and settings to control UI affordances.
Edge cases: Default settings if missing (backward compatibility).
Notes: Keep response consistent for both group and DM (DM has isGroup=false).
*/
export async function getChat(req, res) {
  const { chatId } = req.params;
  const chat = await Chat.findById(chatId)
    .populate("participants", "name email avatar")
    .populate("admins", "name email avatar")
    .populate("createdBy", "name email avatar");
  if (!chat) return res.status(404).json({ message: "Chat not found" });
  if (!chat.settings)
    chat.settings = { onlyAdminsCanMessage: false, onlyAdminsCanEditInfo: true };
  res.json(chat);
}

/*
[PRO] Purpose: Create a new group with sane defaults.
Context: Creator automatically becomes admin; optionally public directory.
Edge cases: Name required; ensure unique participant set; default settings applied.
Notes: Return hydrated doc for immediate UI insert.
*/
export async function createGroup(req, res) {
  const { name, members = [], description = "", iconUrl = "", settings = {} } =
    req.body;
  if (!name?.trim())
    return res.status(400).json({ message: "Group name required" });

  const me = req.user._id;
  const unique = [...new Set([...members.map(String), String(me)])];

  const chat = await Chat.create({
    isGroup: true,
    name: name.trim(),
    description,
    iconUrl,
    participants: unique,
    admins: [me],
    createdBy: me,
    settings: {
      onlyAdminsCanMessage: !!settings.onlyAdminsCanMessage,
      onlyAdminsCanEditInfo: settings.onlyAdminsCanEditInfo !== false,
      isPublic: !!settings.isPublic,
    },
  });

  const full = await Chat.findById(chat._id)
    .populate("participants", "name email avatar")
    .populate("admins", "name email avatar")
    .populate("createdBy", "name email avatar");

  res.status(201).json(full);
}

/*
[PRO] Purpose: Update group basic fields with admin guard.
Context: Some workspaces allow non-admin edits; respect setting.
Edge cases: Ensure settings default first; enforce permission check early.
Notes: Hydrate for client to replace its model in-place.
*/
export async function updateGroup(req, res) {
  const { chatId } = req.params;
  const { name, description, iconUrl } = req.body;

  const chat = await Chat.findById(chatId);
  if (!chat || !chat.isGroup)
    return res.status(404).json({ message: "Group not found" });

  if (!chat.settings)
    chat.settings = { onlyAdminsCanMessage: false, onlyAdminsCanEditInfo: true };

  const isAdmin = chat.admins.some((a) => String(a) === String(req.user._id));
  const onlyAdminsCanEditInfo = chat.settings.onlyAdminsCanEditInfo !== false;
  const canEdit = isAdmin || !onlyAdminsCanEditInfo;
  if (!canEdit)
    return res.status(403).json({ message: "Only admins can edit group info" });

  if (name !== undefined) chat.name = name;
  if (description !== undefined) chat.description = description;
  if (iconUrl !== undefined) chat.iconUrl = iconUrl;

  await chat.save();

  const full = await Chat.findById(chatId)
    .populate("participants", "name email avatar")
    .populate("admins", "name email avatar")
    .populate("createdBy", "name email avatar");

  res.json(full);
}

/*
[PRO] Purpose: Toggle core group settings (admin-only).
Context: Two flags drive UI permissions for messaging and editing info.
Edge cases: Ensure chat is group; enforce admin check.
Notes: Return hydrated chat for client state replacement.
*/
export async function updateGroupSettings(req, res) {
  const { chatId } = req.params;
  const { onlyAdminsCanMessage, onlyAdminsCanEditInfo } = req.body;

  const chat = await Chat.findById(chatId);
  if (!chat || !chat.isGroup)
    return res.status(404).json({ message: "Group not found" });

  const isAdmin = chat.admins.some((a) => String(a) === String(req.user._id));
  if (!isAdmin)
    return res.status(403).json({ message: "Only admins can change settings" });

  if (!chat.settings) chat.settings = {};

  if (typeof onlyAdminsCanMessage === "boolean")
    chat.settings.onlyAdminsCanMessage = onlyAdminsCanMessage;
  if (typeof onlyAdminsCanEditInfo === "boolean")
    chat.settings.onlyAdminsCanEditInfo = onlyAdminsCanEditInfo;

  await chat.save();

  const full = await Chat.findById(chatId)
    .populate("participants", "name email avatar")
    .populate("admins", "name email avatar");
  res.json(full);
}

/*
[PRO] Purpose: Add a member (admin-only).
Context: Avoid duplicates; keep participants/admins consistent.
Edge cases: Non-admin returns 403; adding existing member is a no-op.
Notes: Hydrate after save so client receives fresh membership lists.
*/
export async function addMember(req, res) {
  const { chatId } = req.params;
  const { userId } = req.body;
  const chat = await Chat.findById(chatId);
  if (!chat || !chat.isGroup)
    return res.status(404).json({ message: "Group not found" });

  const isAdmin = chat.admins.some((a) => String(a) === String(req.user._id));
  if (!isAdmin) return res.status(403).json({ message: "Only admins can add" });

  const exists = chat.participants.some((p) => String(p) === String(userId));
  if (!exists) chat.participants.push(userId);

  await chat.save();

  const full = await Chat.findById(chatId)
    .populate("participants", "name email avatar")
    .populate("admins", "name email avatar");
  res.json(full);
}

/*
[PRO] Purpose: Remove a member (admin-only) and drop admin role if present.
Context: Keeps admin list valid after removal.
Edge cases: Attempt to remove non-member is effectively a no-op.
Notes: Hydrate for client.
*/
export async function removeMember(req, res) {
  const { chatId } = req.params;
  const { userId } = req.body;
  const chat = await Chat.findById(chatId);
  if (!chat || !chat.isGroup)
    return res.status(404).json({ message: "Group not found" });

  const isAdmin = chat.admins.some((a) => String(a) === String(req.user._id));
  if (!isAdmin)
    return res.status(403).json({ message: "Only admins can remove" });

  chat.participants = chat.participants.filter(
    (p) => String(p) !== String(userId)
  );
  chat.admins = chat.admins.filter((a) => String(a) !== String(userId));
  await chat.save();

  const full = await Chat.findById(chatId)
    .populate("participants", "name email avatar")
    .populate("admins", "name email avatar");
  res.json(full);
}

/*
[PRO] Purpose: Grant admin role to a member.
Context: Admin guard; user must already be a participant.
Edge cases: Promoting non-member returns 400.
Notes: Idempotent—won’t duplicate admin entry.
*/
export async function promoteAdmin(req, res) {
  const { chatId } = req.params;
  const { userId } = req.body;

  const chat = await Chat.findById(chatId);
  if (!chat || !chat.isGroup)
    return res.status(404).json({ message: "Group not found" });

  const isAdmin = chat.admins.some((a) => String(a) === String(req.user._id));
  if (!isAdmin)
    return res.status(403).json({ message: "Only admins can promote" });

  const isMember = chat.participants.some((p) => String(p) === String(userId));
  if (!isMember) return res.status(400).json({ message: "User not in group" });

  if (!chat.admins.some((a) => String(a) === String(userId)))
    chat.admins.push(userId);
  await chat.save();

  const full = await Chat.findById(chatId)
    .populate("participants", "name email avatar")
    .populate("admins", "name email avatar");
  res.json(full);
}

/*
[PRO] Purpose: Revoke admin role from a user.
Context: Ensure at least one admin remains if there are participants.
Edge cases: If none left, assign first participant as admin.
Notes: Hydrate for client.
*/
export async function demoteAdmin(req, res) {
  const { chatId } = req.params;
  const { userId } = req.body;

  const chat = await Chat.findById(chatId);
  if (!chat || !chat.isGroup)
    return res.status(404).json({ message: "Group not found" });

  const isAdmin = chat.admins.some((a) => String(a) === String(req.user._id));
  if (!isAdmin)
    return res.status(403).json({ message: "Only admins can demote" });

  chat.admins = chat.admins.filter((a) => String(a) !== String(userId));
  if (chat.admins.length === 0 && chat.participants.length > 0) {
    chat.admins = [chat.participants[0]];
  }
  await chat.save();

  const full = await Chat.findById(chatId)
    .populate("participants", "name email avatar")
    .populate("admins", "name email avatar");
  res.json(full);
}

/*
[PRO] Purpose: Allow a user to leave a group safely.
Context: Remove from participants and admins; keep at least one admin if members remain.
Edge cases: Group may end up empty—leave as-is for history.
Notes: Hydrate for client.
*/
export async function leaveGroup(req, res) {
  const { chatId } = req.params;
  const me = req.user._id;

  const chat = await Chat.findById(chatId);
  if (!chat || !chat.isGroup)
    return res.status(404).json({ message: "Group not found" });

  chat.participants = chat.participants.filter(
    (p) => String(p) !== String(me)
  );
  chat.admins = chat.admins.filter((a) => String(a) !== String(me));

  if (chat.participants.length > 0 && chat.admins.length === 0) {
    chat.admins = [chat.participants[0]];
  }
  await chat.save();

  const full = await Chat.findById(chatId)
    .populate("participants", "name email avatar")
    .populate("admins", "name email avatar");
  res.json(full);
}

/*
[PRO] Purpose: Hard-delete a group (admin-only) and its messages.
Context: Irreversible—used by admins to clean up.
Edge cases: Non-admin forbidden; DM cannot be deleted here.
Notes: Consider soft-delete if you add audit requirements later.
*/
export async function deleteGroup(req, res) {
  const { chatId } = req.params;
  const chat = await Chat.findById(chatId);
  if (!chat || !chat.isGroup)
    return res.status(404).json({ message: "Group not found" });

  const isAdmin = chat.admins.some((a) => String(a) === String(req.user._id));
  if (!isAdmin) return res.status(403).json({ message: "Only admins can delete" });

  await Message.deleteMany({ chat: chatId });
  await Chat.findByIdAndDelete(chatId);
  res.json({ ok: true });
}

/*
[PRO] Purpose: Join a public group by id.
Context: No-op if already a member; public status required.
Edge cases: Not public => 403; non-group => 404.
Notes: Hydrate for client immediately after join.
*/
export async function joinPublicGroup(req, res) {
  const userId = req.user._id;
  const { chatId } = req.params;

  const chat = await Chat.findById(chatId);
  if (!chat || !chat.isGroup)
    return res.status(404).json({ message: "Group not found" });
  if (!chat.settings?.isPublic)
    return res.status(403).json({ message: "Group is not public" });

  const already = (chat.participants || []).some(
    (p) => String(p) === String(userId)
  );
  if (!already) {
    chat.participants.push(userId);
    await chat.save();
  }

  const hydrated = await Chat.findById(chatId)
    .populate("participants", "_id name email avatar")
    .populate("admins", "_id name email")
    .lean();

  res.json(hydrated);
}

/*
[PRO] Purpose: Toggle group public visibility (admin-only).
Context: Adds/removes group from public directory.
Edge cases: Non-admin => 403; non-group => 404.
Notes: Hydrate for client.
*/
export async function setGroupPublic(req, res) {
  const me = req.user._id;
  const { chatId } = req.params;
  const { isPublic } = req.body;

  const chat = await Chat.findById(chatId);
  if (!chat || !chat.isGroup)
    return res.status(404).json({ message: "Group not found" });

  const isAdmin = (chat.admins || []).some((a) => String(a) === String(me));
  if (!isAdmin) return res.status(403).json({ message: "Admins only" });

  chat.settings = { ...chat.settings, isPublic: !!isPublic };
  await chat.save();

  const hydrated = await Chat.findById(chatId)
    .populate("participants", "_id name email avatar")
    .populate("admins", "_id name email")
    .lean();

  res.json(hydrated);
}

/*
[PRO] Purpose: Return a compact list of public groups for a directory.
Context: Ordered by recent activity; capped for performance.
Edge cases: Missing fields normalized; membersCount computed safely.
Notes: Increase limit or add pagination when needed.
*/
export async function listPublicGroups(req, res) {
  const { limit = 50 } = req.query;
  const groups = await Chat.find({ isGroup: true, "settings.isPublic": true })
    .select(
      "_id name description iconUrl participants settings lastMessageAt createdAt"
    )
    .sort({ lastMessageAt: -1, createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 200))
    .lean();

  const shaped = groups.map((g) => ({
    _id: g._id,
    name: g.name,
    description: g.description || "",
    iconUrl: g.iconUrl || "",
    isPublic: !!g.settings?.isPublic,
    membersCount: Array.isArray(g.participants) ? g.participants.length : 0,
    lastMessageAt: g.lastMessageAt || g.createdAt,
  }));

  res.json(shaped);
}

/*
[PRO] Purpose: Return recent media messages in a chat.
Context: Used by profile/media tab and gallery views.
Edge cases: None—limit to 200 for fast load.
Notes: Consider paging if histories grow large.
*/
export async function listChatMedia(req, res) {
  const { chatId } = req.params;
  const items = await Message.find({
    chat: chatId,
    type: { $in: ["image", "video", "audio"] },
  })
    .select(
      "_id type mediaUrl mediaName mediaSize mediaDuration createdAt sender"
    )
    .sort({ createdAt: -1 })
    .limit(200);
  res.json(items);
}

/*
[PRO] Purpose: Return text messages that contain URLs.
Context: Feeds “links” tab for a chat.
Edge cases: Simple regex finds http(s) tokens; consider parser later if needed.
Notes: Keep projection small; cap to 200.
*/
export async function listChatLinks(req, res) {
  const { chatId } = req.params;
  const regex = /(https?:\/\/[^\s]+)/i;
  const items = await Message.find({
    chat: chatId,
    type: "text",
    text: { $regex: regex },
  })
    .select("_id text createdAt sender")
    .sort({ createdAt: -1 })
    .limit(200);
  res.json(items);
}

/*
[PRO] Purpose: Clear all messages in a chat (admin-only for groups).
Context: Resets list view immediately; preserves chat shell.
Edge cases: Non-admin group member => 403; DM allowed for either participant.
Notes: Touch lastMessageAt so ordering reflects the change.
*/
export async function clearChat(req, res) {
  const { chatId } = req.params;
  const chat = await Chat.findById(chatId);
  if (!chat) return res.status(404).json({ message: "Chat not found" });

  if (chat.isGroup) {
    const isAdmin = (chat.admins || []).some(
      (a) => String(a) === String(req.user._id)
    );
    if (!isAdmin)
      return res
        .status(403)
        .json({ message: "Only admins can clear group history" });
  }

  await Message.deleteMany({ chat: chatId });
  chat.lastMessageAt = new Date();
  await chat.save();
  res.json({ ok: true });
}
