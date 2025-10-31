// server/src/routes/auth.routes.js
/*
[PRO] Purpose: Define authentication-related HTTP endpoints (register/login, email verification, password reset, and protected account updates).
Context: Consolidates both OTP-based and legacy link flows so the client can migrate without breaking existing users.
Edge cases: Do not leak whether an email exists on OTP sends; guard protected routes with auth middleware.
Notes: Keep OTP routes fast; email delivery failures should not expose internals to clients.
*/
import { Router } from 'express';
import {
  register, login,
  verifyEmail, resendVerification,
  sendEmailVerifyCode, verifyEmailWithCode,
  forgotPassword, resetPasswordWithCode,
  changePassword, changeEmailStart, changeEmailConfirm
} from '../controllers/auth.controller.js';
import { auth } from '../middleware/auth.js';

const r = Router();

// Core auth
r.post('/register', register);
r.post('/login', login);

// Email verify via one-time code
r.post('/send-verify', sendEmailVerifyCode);     // body: { email }
r.post('/verify-code', verifyEmailWithCode);     // body: { email, code }

// Legacy link flows (optional)
r.get('/verify-email', verifyEmail);
r.post('/resend-verification', resendVerification);

// Password reset via one-time code
r.post('/forgot', forgotPassword);               // body: { email }
r.post('/reset/confirm', resetPasswordWithCode); // body: { email, code, password }

// Account updates (protected)
r.post('/change-password', auth, changePassword);
r.post('/change-email', auth, changeEmailStart);
r.get('/verify-new-email', changeEmailConfirm);

export default r;
