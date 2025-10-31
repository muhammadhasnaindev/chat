// server/src/controllers/call.controller.js

/*
[PRO] Purpose: Persist lightweight call logs per participant so each user sees their own history.
Context: CallPanel can fire start/end hooks; we store one row per participant (owner).
Edge cases: Idempotent-ish end hook (bulk match by chat+startedAt). Missing chat returns 404.
Notes: Keep logs lean; hydrate just enough for list UI. Extend schema if you later add recordings.
*/
import Call from "../models/Call.js";
import Chat from "../models/Chat.js";

/*
[PRO] Purpose: Return recent calls for the authenticated user.
Context: Sorted newest-first; include basic chat & user fields for list rows.
Edge cases: None—empty array allowed; cap to 100 for fast UI.
Notes: Use .lean() for perf; adjust limit if you add pagination.
*/
export async function listMyCalls(req, res) {
  const me = req.user._id;
  const calls = await Call.find({ owner: me })
    .sort({ startedAt: -1 })
    .limit(100)
    .populate("chat", "isGroup name iconUrl")
    .populate("caller", "name email avatar")
    .populate("callee", "name email avatar")
    .lean();

  res.json(calls);
}

/*
[PRO] Purpose: Log the beginning of a call across all participants.
Context: Create one Call row per participant (owner) so everyone sees the call.
Edge cases: Chat must exist; dedupe participant ids; mark direction per owner.
Notes: Keep status 'ongoing' until end hook updates duration/status.
*/
export async function logCallStart(req, res) {
  const me = req.user._id;
  const { chatId, kind = "audio", participants = [] } = req.body;

  const chat = await Chat.findById(chatId).lean();
  if (!chat) return res.status(404).json({ message: "Chat not found" });

  const par = new Set([me.toString(), ...participants.map(String)]);
  const toCreate = [...par].map((ownerId) => ({
    owner: ownerId,
    chat: chatId,
    participants: [...par],
    caller: me,
    kind,
    direction: ownerId === me.toString() ? "outgoing" : "incoming",
    status: "ongoing",
    startedAt: new Date(),
  }));

  const created = await Call.insertMany(toCreate);
  res.status(201).json(created);
}

/*
[PRO] Purpose: Finalize a call (set status, endedAt, duration).
Context: Match all per-owner rows by chatId + startedAt to close the same call.
Edge cases: If no docs matched (e.g., race or missing start), return ok with updated:0.
Notes: Duration computed server-side to prevent client tampering.
*/
export async function logCallEnd(req, res) {
  const { startedAt, chatId, status = "completed" } = req.body;

  const q = { chat: chatId, startedAt: new Date(startedAt) };
  const docs = await Call.find(q);
  if (!docs.length) return res.json({ ok: true, updated: 0 });

  const endedAt = new Date();
  const bulk = docs.map((d) => ({
    updateOne: {
      filter: { _id: d._id },
      update: {
        $set: {
          status,
          endedAt,
          durationSec: Math.max(0, Math.round((endedAt - d.startedAt) / 1000)),
        },
      },
    },
  }));

  const result = await Call.bulkWrite(bulk);
  res.json({ ok: true, updated: result.modifiedCount });
}
