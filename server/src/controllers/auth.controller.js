// server/src/controllers/auth.controller.js

/*
[PRO] Purpose:
  Central auth endpoints: registration, login, email verification (code/link),
  password reset (code), and protected account changes.

Context:
  Keep logic thin; model methods (e.g., password hashing/compare) live in User.
  Email sending is best-effort; API should not leak whether an email exists.

Edge cases:
  - OTP/link expiries must be enforced server-side.
  - Email flows shouldn’t disclose user existence (privacy).
  - Missing secrets/env should fail fast.

Notes:
  Timeouts and TTLs pulled into constants for clarity and future tweaks.
  Error messages are user-safe; server logs keep the details.
*/
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import User from "../models/User.js";
import { sendEmail, emailTemplateOTP } from "../lib/mailer.js";

/* ---------- Constants (no magic numbers) ---------- */
const JWT_EXPIRES_IN = "30d";
const OTP_TTL_MIN = 10;
const LINK_TTL_HOURS = 24;

/*
[PRO] Purpose:
  JWT issue + user serializer helpers kept here to avoid repetition.

Context:
  Token payload is minimal; serializer returns only safe fields for client.

Edge cases:
  - Missing JWT secret => fail fast on first use.
  - Serializer must not leak sensitive fields.

Notes:
  If additional claims needed, add here (keep payload small).
*/
function signToken(user) {
  if (!env.JWT_SECRET) {
    throw new Error("JWT secret not configured");
  }
  return jwt.sign(
    { id: user._id, email: user.email },
    env.JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}
function sanitize(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    about: user.about,
    emailVerified: user.emailVerified,
  };
}

/*
[PRO] Purpose:
  Token + OTP helpers.

Context:
  OTP is 6 digits. Prefer crypto.randomInt over Math.random for uniformity.

Edge cases:
  - Ensure hex token length exactly as requested.
  - OTP must be string to preserve leading zeros.

Notes:
  Keep generation synchronous for simplicity and low latency.
*/
function randToken(len = 40) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}
function genOTP() {
  // 000000–999999 inclusive, fixed 6 digits
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

/* ===================================================
   Register / Login
   =================================================== */

/**
 * Register a user and send an email verification code.
 */
export async function register(req, res) {
  try {
    const { name, email, password, avatar = "", about = "" } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Missing fields" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ message: "Email already in use" });

    const code = genOTP();
    const user = await User.create({
      name,
      email,
      password,
      avatar,
      about,
      emailVerified: false,
      emailOTP: code,
      emailOTPExpires: new Date(Date.now() + OTP_TTL_MIN * 60 * 1000),
    });

    // Send verification code (best-effort)
    try {
      await sendEmail({
        to: email,
        subject: "Verify your email (code inside)",
        html: emailTemplateOTP({
          title: "Verify your email",
          code,
          body: `Hi ${name}, use this code to verify your account.`,
        }),
      });
    } catch (e) {
      console.error("Register: email send failed (user created).", e?.message || e);
    }

    const token = signToken(user);
    return res.json({ token, user: sanitize(user) });
  } catch (e) {
    console.error("REGISTER ERROR:", e?.message || e);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Login with email + password.
 */
export async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: "Missing fields" });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = signToken(user);
    return res.json({ token, user: sanitize(user) });
  } catch (e) {
    console.error("LOGIN ERROR:", e?.message || e);
    return res.status(500).json({ message: "Server error" });
  }
}

/* ===================================================
   Email verification (OTP)
   =================================================== */

/**
 * Send a fresh verification code to an email (silent if not found).
 */
export async function sendEmailVerifyCode(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ message: "Email required" });

    const u = await User.findOne({ email }).lean();
    if (!u) return res.json({ ok: true }); // privacy
    if (u.emailVerified) return res.json({ ok: true });

    const code = genOTP();
    await User.updateOne(
      { _id: u._id },
      {
        $set: {
          emailOTP: code,
          emailOTPExpires: new Date(Date.now() + OTP_TTL_MIN * 60 * 1000),
        },
      }
    );

    await sendEmail({
      to: email,
      subject: "Your verification code",
      html: emailTemplateOTP({ title: "Email verification code", code }),
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("sendEmailVerifyCode:", e?.message || e);
    res.status(500).json({ message: "Server error" });
  }
}

/**
 * Confirm email with a 6-digit code.
 */
export async function verifyEmailWithCode(req, res) {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ message: "Missing fields" });

    const u = await User.findOne({
      email,
      emailOTP: code,
      emailOTPExpires: { $gt: new Date() },
    });
    if (!u) return res.status(400).json({ message: "Invalid or expired code" });

    u.emailVerified = true;
    u.emailOTP = undefined;
    u.emailOTPExpires = undefined;
    await u.save();

    res.json({ message: "Email verified" });
  } catch (e) {
    console.error("verifyEmailWithCode:", e?.message || e);
    res.status(500).json({ message: "Server error" });
  }
}

/* ===================================================
   Legacy link verification (optional)
   =================================================== */

/**
 * GET /verify-email?token=...
 */
export async function verifyEmail(req, res) {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: "Missing token" });

    const u = await User.findOne({
      emailVerifyToken: token,
      emailVerifyTokenExpires: { $gt: new Date() },
    });
    if (!u) return res.status(400).json({ message: "Invalid or expired token" });

    u.emailVerified = true;
    u.emailVerifyToken = undefined;
    u.emailVerifyTokenExpires = undefined;
    await u.save();

    res.json({ message: "Email verified" });
  } catch (e) {
    console.error("verifyEmail (legacy):", e?.message || e);
    res.status(500).json({ message: "Server error" });
  }
}

/**
 * POST resend verification link (legacy).
 */
export async function resendVerification(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ message: "Email required" });

    const u = await User.findOne({ email });
    if (!u) return res.json({ ok: true });
    if (u.emailVerified) return res.json({ ok: true });

    u.emailVerifyToken = randToken(48);
    u.emailVerifyTokenExpires = new Date(Date.now() + LINK_TTL_HOURS * 60 * 60 * 1000);
    await u.save();

    const link = `${env.APP_URL}/verify-email?token=${u.emailVerifyToken}`;
    await sendEmail({
      to: u.email,
      subject: "Verify your email",
      html: `<p>Verify link: <a href="${link}">${link}</a></p>`,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("resendVerification:", e?.message || e);
    res.status(500).json({ message: "Server error" });
  }
}

/* ===================================================
   Password reset via OTP code
   =================================================== */

/**
 * Start password reset: send a 6-digit code (silent if email unknown).
 */
export async function forgotPassword(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ message: "Email required" });

    const u = await User.findOne({ email }).lean();
    if (!u) return res.json({ ok: true }); // privacy

    const code = genOTP();
    await User.updateOne(
      { _id: u._id },
      {
        $set: {
          resetCode: code,
          resetCodeExpires: new Date(Date.now() + OTP_TTL_MIN * 60 * 1000),
        },
      }
    );

    await sendEmail({
      to: email,
      subject: "Password reset code",
      html: emailTemplateOTP({
        title: "Reset code",
        code,
        body: "Use this code to reset your password.",
      }),
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("forgotPassword:", e?.message || e);
    res.status(500).json({ message: "Server error" });
  }
}

/**
 * Confirm password reset with email + code + new password.
 */
export async function resetPasswordWithCode(req, res) {
  try {
    const { email, code, password } = req.body || {};
    if (!email || !code || !password) return res.status(400).json({ message: "Missing fields" });
    if (String(password).length < 6) return res.status(400).json({ message: "Password too short" });

    const u = await User.findOne({
      email,
      resetCode: code,
      resetCodeExpires: { $gt: new Date() },
    });
    if (!u) return res.status(400).json({ message: "Invalid or expired code" });

    u.password = password;
    u.resetCode = undefined;
    u.resetCodeExpires = undefined;
    await u.save();

    res.json({ message: "Password updated" });
  } catch (e) {
    console.error("resetPasswordWithCode:", e?.message || e);
    res.status(500).json({ message: "Server error" });
  }
}

/* ===================================================
   Protected updates (require auth)
   =================================================== */

/**
 * Change password for the logged-in user.
 */
export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: "Missing fields" });
    if (String(newPassword).length < 6)
      return res.status(400).json({ message: "Password too short" });

    const u = await User.findById(req.user._id);
    const ok = await u.comparePassword(currentPassword);
    if (!ok) return res.status(400).json({ message: "Current password incorrect" });

    u.password = newPassword;
    await u.save();
    res.json({ message: "Password changed" });
  } catch (e) {
    console.error("changePassword:", e?.message || e);
    res.status(500).json({ message: "Server error" });
  }
}

/**
 * Start change email flow (send verification to new email).
 */
export async function changeEmailStart(req, res) {
  try {
    const { newEmail } = req.body || {};
    if (!newEmail) return res.status(400).json({ message: "Missing newEmail" });
    const exists = await User.findOne({ email: newEmail });
    if (exists) return res.status(409).json({ message: "Email already in use" });

    const u = await User.findById(req.user._id);
    u.pendingEmail = newEmail;
    u.pendingEmailToken = randToken(48);
    u.pendingEmailExpires = new Date(Date.now() + LINK_TTL_HOURS * 60 * 60 * 1000);
    await u.save();

    const link = `${env.APP_URL}/verify-new-email?token=${u.pendingEmailToken}`;
    await sendEmail({
      to: newEmail,
      subject: "Verify your new email",
      html: `<p>Verify: <a href="${link}">${link}</a></p>`,
    });
    res.json({ message: "Verification sent to new email" });
  } catch (e) {
    console.error("changeEmailStart:", e?.message || e);
    res.status(500).json({ message: "Server error" });
  }
}

/**
 * Confirm change email with token (legacy link flow).
 */
export async function changeEmailConfirm(req, res) {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: "Missing token" });

    const u = await User.findOne({
      pendingEmailToken: token,
      pendingEmailExpires: { $gt: new Date() },
    });
    if (!u) return res.status(400).json({ message: "Invalid or expired token" });

    u.email = u.pendingEmail;
    u.pendingEmail = undefined;
    u.pendingEmailToken = undefined;
    u.pendingEmailExpires = undefined;
    u.emailVerified = true;
    await u.save();

    res.json({ message: "Email updated" });
  } catch (e) {
    console.error("changeEmailConfirm:", e?.message || e);
    res.status(500).json({ message: "Server error" });
  }
}
