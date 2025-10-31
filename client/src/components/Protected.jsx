/**
 * Protected — minimal route guard for auth + email verification.

 */

import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import useAuth from "../store/authStore";

/*
[PRO] Purpose: Ensure only authenticated (and verified) users reach protected routes
Context: Avoids rendering shells that immediately redirect on mount
Edge cases: Preserve intended route via replace; handle missing user object safely
Notes: Keeps logic synchronous; no side effects here
*/
export default function Protected() {
  const { token, user } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  if (user && user.emailVerified === false) {
    const email = encodeURIComponent(user.email || "");
    return <Navigate to={`/verify-email?email=${email}`} replace />;
  }
  return <Outlet />;
}
