// server/src/middleware/auth.js
/*
[PRO] Purpose: Authenticate API requests using a Bearer JWT; attach minimal user to req.user.
Context: Protects private routes; pairs with controllers expecting req.user.
Edge cases: Missing/invalid token → 401; deleted user → 401; token expiry handled by verify.
Notes: Select only needed fields to keep req lightweight. Exports both auth and authMiddleware for compatibility.
*/
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import User from "../models/User.js";

export async function auth(req, res, next) {
  try {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    const payload = jwt.verify(token, env.JWT_SECRET);
    const user = await User.findById(payload.id).select("_id email name avatar");
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    req.user = user;
    next();
  } catch (_e) {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

// Back-compat alias
export const authMiddleware = auth;
