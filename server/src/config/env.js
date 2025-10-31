/*
[PRO] Purpose:
  Centralize environment variable loading and defaults.

Context:
  Avoid sprinkling `process.env` reads across the codebase. Easier to audit,
  validate, and provide environment fallbacks.

Edge cases:
  - Missing required variables should be noticed early.
  - SMTP and AWS are optional; keep structure consistent even if unset.

Notes:
  If server root changes, adjust config() path accordingly.
*/
import dotenv from "dotenv";

// If env file is not in project root, specify path: dotenv.config({ path: '../.env' })
dotenv.config();

export const env = {
  PORT: process.env.PORT || 5000,
  MONGO_URI: process.env.MONGO_URI,
  JWT_SECRET: process.env.JWT_SECRET,

  // CORS origin list (comma separated)
  CORS_ORIGIN: process.env.CORS_ORIGIN,

  AWS: {
    ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    REGION: process.env.AWS_REGION,
    S3_BUCKET: process.env.S3_BUCKET,
  },

  VAPID: {
    SUBJECT: process.env.VAPID_SUBJECT,
    PUBLIC_KEY: process.env.WEB_PUSH_PUBLIC_KEY,
    PRIVATE_KEY: process.env.WEB_PUSH_PRIVATE_KEY,
  },

  SMTP: {
    DEMO_MODE: (process.env.DEMO_MODE || "false").toLowerCase() === "true",
    HOST: process.env.SMTP_HOST,
    PORT: Number(process.env.SMTP_PORT || 587),
    USER: process.env.SMTP_USER,
    PASS: process.env.SMTP_PASS,
    FROM: process.env.SMTP_FROM,
  },

  APP_URL: process.env.APP_URL || "http://localhost:5173",
};
