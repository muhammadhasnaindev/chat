// server/src/models/Chat.js
/*
[PRO] Purpose: Represent DM and group chats, including membership, admins, settings, and activity.
Context: Adds discoverability controls (isPublic) and admin-only edit/message gates like WhatsApp.
Edge cases: Empty admin list after removals → controllers ensure at least one admin remains if members exist.
Notes: Text index weights name higher than description for better public group search relevance.
*/
import mongoose from "mongoose";

const { Schema, model } = mongoose;

const ChatSchema = new Schema(
  {
    // Type
    isGroup: { type: Boolean, default: false, index: true },

    // Group metadata
    name: { type: String, trim: true },
    description: { type: String, default: "" },
    iconUrl: { type: String, default: "" },

    // Membership
    participants: [{ type: Schema.Types.ObjectId, ref: "User" }],

    // Admins and creator
    admins: [{ type: Schema.Types.ObjectId, ref: "User" }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },

    // Settings
    settings: {
      onlyAdminsCanMessage: { type: Boolean, default: false },
      onlyAdminsCanEditInfo: { type: Boolean, default: true },
      isPublic: { type: Boolean, default: false }, // discoverable and joinable
    },

    // Activity marker for sort
    lastMessageAt: { type: Date },
  },
  { timestamps: true }
);

// Discovery and sort
ChatSchema.index({ isGroup: 1, "settings.isPublic": 1, lastMessageAt: -1 });

// Weighted text index for search (name prioritized)
ChatSchema.index(
  { name: "text", description: "text" },
  { weights: { name: 10, description: 3 }, name: "chat_text", default_language: "none" }
);

export default model("Chat", ChatSchema);
