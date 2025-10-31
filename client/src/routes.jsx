/*
[PRO] Purpose: Centralize app routing with optional auth protection.
Context: PrivateRoute ensures only authenticated users can access Chat.
Edge cases: Token not yet restored on page load—Zustand handles initial localStorage sync.
Notes: Keep route surface minimal; additional pages mount elsewhere.
*/
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Chat from "./pages/Chat";
import useAuth from "./store/authStore";

function PrivateRoute({ children }) {
  const token = useAuth((s) => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

export default function RoutesEl() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route
        path="/"
        element={
          <PrivateRoute>
            <Chat />
          </PrivateRoute>
        }
      />
    </Routes>
  );
}
