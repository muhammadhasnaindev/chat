// server/src/models/Call.js
/*
[PRO] Purpose: Persist call history per participant for quick "My calls" listing and analytics.
Context: We log one row per participant (owner) so queries are simple and fast without post-filtering.
Edge cases: Group vs DM; optional callee in DMs; missed/declined/completed states; duration computed on end.
Notes: Index on (owner, startedAt) supports recent lists; keep startedAt consistent across owners for the same call.
*/
import mongoose from "mongoose";
const { Schema, model } = mongoose;

const CallSchema = new Schema(
  {
    chat: { type: Schema.Types.ObjectId, ref: "Chat", index: true },
    participants: [{ type: Schema.Types.ObjectId, ref: "User" }], // all participants in this call
    caller: { type: Schema.Types.ObjectId, ref: "User" },         // who initiated
    callee: { type: Schema.Types.ObjectId, ref: "User" },         // optional in DMs
    kind: { type: String, enum: ["audio", "video"], default: "audio" },
    direction: { type: String, enum: ["outgoing", "incoming"], default: "outgoing" }, // per-owner perspective
    status: { type: String, enum: ["missed", "declined", "completed", "ongoing"], default: "ongoing", index: true },
    startedAt: { type: Date, default: Date.now, index: true },
    endedAt: { type: Date },
    durationSec: { type: Number, default: 0 },
    // Per-user owner row so "my calls" is a simple find({ owner })
    owner: { type: Schema.Types.ObjectId, ref: "User", index: true },
  },
  { timestamps: true }
);

// Recent calls list query path
CallSchema.index({ owner: 1, startedAt: -1 });

export default model("Call", CallSchema);
