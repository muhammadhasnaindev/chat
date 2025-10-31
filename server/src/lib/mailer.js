// server/src/lib/mailer.js
/*
[PRO] Purpose: Send transactional emails (OTP, verification) via SMTP with a demo fallback.
Context: Centralizes mail transport; supports real SMTP or a log-only mode for dev/testing.
Edge cases: Missing SMTP creds → still works if relay allows unauth; demo mode logs payload instead of sending.
Notes: STARTTLS on 587; SSL on 465. From address prefers env.SMTP.FROM, then USER. Throw to caller on hard failures.
*/
import nodemailer from "nodemailer";
import { env } from "../config/env.js";

let transporter;

function buildTransport() {
  const host = env?.SMTP?.HOST?.trim() || "smtp.gmail.com";
  const port = Number(env?.SMTP?.PORT || 587);
  const user = env?.SMTP?.USER;
  const pass = env?.SMTP?.PASS;
  const demo = !!env?.SMTP?.DEMO_MODE;

  if (demo) {
    return {
      sendMail: async (opts) => {
        console.log("\n=== DEMO EMAIL (not sent) ===");
        console.log("From:", env.SMTP.FROM || user || "no-reply@localhost");
        console.log("To:", opts.to);
        console.log("Subject:", opts.subject);
        if (opts.text) console.log("Text:", opts.text);
        if (opts.html) console.log("HTML:", opts.html);
        console.log("=============================\n");
        return { messageId: "demo" };
      },
    };
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,     // 465: SSL; 587: STARTTLS
    requireTLS: port === 587, // enforce STARTTLS on 587
    auth: user && pass ? { user, pass } : undefined,
  });
}

export async function sendEmail({ to, subject, text, html }) {
  try {
    if (!transporter) transporter = buildTransport();
    const from = env.SMTP.FROM || env.SMTP.USER || "no-reply@localhost";

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html: html || (text ? `<pre>${text}</pre>` : undefined),
    });
    return info;
  } catch (e) {
    console.error("EMAIL SEND ERROR:", e?.message || e);
    throw e;
  }
}

export function emailTemplateOTP({ title = "Your Code", code, body = "" }) {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <h2 style="margin:0 0 8px 0">${title}</h2>
    ${body ? `<p style="margin:0 0 8px 0">${body}</p>` : ""}
    <div style="font-size:32px;letter-spacing:6px;font-weight:700;margin:16px 0">${code}</div>
    <p style="color:#555;margin:0">This code expires in 10 minutes. If you didn’t request it, ignore this email.</p>
  </div>
  `;
}
