// server/src/models/User.js
/*
[PRO] Purpose: User identity, credentials, verification state, and preferences.
Context: Supports both link and code flows for email verification and password reset.
Edge cases: Password hashing only when modified; unique email; optional push subscriptions.
Notes: Keep only necessary fields indexed; comparePassword uses bcrypt for timing-safe verification.
*/
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const { Schema } = mongoose;

const PushSubSchema = new Schema(
  {
    endpoint: String,
    keys: { p256dh: String, auth: String },
  },
  { _id: false }
);

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, unique: true, index: true, required: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },

    avatar: String,
    about: { type: String, default: "" },

    lastSeen: { type: Date, default: Date.now },
    blocked: [{ type: Schema.Types.ObjectId, ref: "User" }],

    // Email verification (link)
    emailVerified: { type: Boolean, default: false },
    emailVerifyToken: String,
    emailVerifyTokenExpires: Date,

    // Email verification via OTP code
    emailOTP: String,
    emailOTPExpires: Date,

    // Change email (pending)
    pendingEmail: String,
    pendingEmailToken: String,
    pendingEmailExpires: Date,

    // Password reset (legacy link)
    resetToken: String,
    resetTokenExpires: Date,

    // Password reset via OTP code
    resetCode: String,
    resetCodeExpires: Date,

    // Optional web push
    pushSubscriptions: [PushSubSchema],
  },
  { timestamps: true }
);

// Hash password only when changed
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (e) {
    return next(e);
  }
});

UserSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

export default mongoose.model("User", UserSchema);
