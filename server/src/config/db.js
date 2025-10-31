/*
[PRO] Purpose:
  Establish a single mongoose connection on server start.

Context:
  Called from index.js before HTTP server listens. We keep it minimal to avoid
  polluting connection lifecycle. Connection errors should surface early.

Edge cases:
  - Invalid MONGO_URI -> process should crash fast rather than run half-connected.
  - Avoid reconnect loops here; mongoose manages its own retry logic.

Notes:
  Keep console output short and predictable for logs/containers.
*/
import mongoose from "mongoose";
import { env } from "./env.js";

export async function connectDB() {
  if (!env.MONGO_URI) {
    console.error("[db] Missing MONGO_URI");
    process.exit(1);
  }

  try {
    await mongoose.connect(env.MONGO_URI, {
      // defaults are fine; override only if needed later
      serverSelectionTimeoutMS: 15000,
    });
    console.log("[db] MongoDB connected");
  } catch (err) {
    console.error("[db] MongoDB connection failed:", err.message);
    process.exit(1);
  }
}
