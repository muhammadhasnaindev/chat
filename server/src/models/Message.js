// server/src/models/Message.js
/*
[PRO] Purpose: Store chat messages with media, replies, reactions, delivery, and deletion metadata.
Context: Supports rich UX (replies, pins, stars, edits) and delivery states (sent/delivered/read).
Edge cases: Soft-delete per user vs delete for all; indexing keeps long chats performant.
Notes: createdAt ascending index supports scroll; reaction index enables quick "who reacted" lookups.
*/
import mongoose from "mongoose";
const { Schema } = mongoose;

const ReactionSchema = new Schema(
  {
    emoji: { type: String, required: true },
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const MessageSchema = new Schema(
  {
    chat: { type: Schema.Types.ObjectId, ref: "Chat", index: true, required: true },
    sender: { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },

    // Content
    type: { type: String, enum: ["text", "image", "video", "audio", "file"], default: "text" },
    text: { type: String },
    mediaUrl: String,
    mediaName: String,
    mediaSize: Number,
    mediaDuration: { type: Number },

    // Relations
    replyTo: { type: Schema.Types.ObjectId, ref: "Message" }, // quoted
    forwardOf: { type: Schema.Types.ObjectId, ref: "Message" }, // original

    // UX flags
    reactions: [ReactionSchema],
    editedAt: { type: Date, default: null },
    pinnedAt: { type: Date, default: null },
    pinnedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    starredBy: [{ type: Schema.Types.ObjectId, ref: "User" }],

    // Delivery
    status: { type: String, enum: ["sent", "delivered", "read"], default: "sent", index: true },
    deliveredTo: [{ type: Schema.Types.ObjectId, ref: "User" }],
    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],

    // Deletion
    deletedFor: [{ type: Schema.Types.ObjectId, ref: "User" }], // per-user hide
    deletedForAllAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Chronological scroll and common filters
MessageSchema.index({ chat: 1, createdAt: 1 });
MessageSchema.index({ "reactions.by": 1 });

export default mongoose.model("Message", MessageSchema);
