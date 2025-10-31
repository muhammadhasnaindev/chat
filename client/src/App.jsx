// client/src/App.jsx
import React from "react";
import { Routes, Route } from "react-router-dom";
import RoutesEl from "./routes";

import Protected from "./components/Protected";

// Auth & account flows
import VerifyEmailCode from "./pages/VerifyEmailCode";
import Forgot from "./pages/Forgot";
import ResetWithCode from "./pages/ResetWithCode";

// Profiles
import ProfileSettings from "./pages/Settings/ProfileSettings";
import PublicProfile from "./pages/Profile/PublicProfile";

export default function App() {
  return (
    <div className="h-screen bg-gray-100">
      <Routes>
        {/* New additions */}
        <Route path="/verify-new-email" element={<VerifyEmailCode />} />

        <Route path="/verify" element={<VerifyEmailCode />} />
        <Route path="/forgot" element={<Forgot />} />

        <Route path="/reset" element={<ResetWithCode />} />

        {/* Protected pages */}
        <Route element={<Protected />}>
          <Route path="/settings/profile" element={<ProfileSettings />} />
        </Route>

        {/* Public profile (shareable) */}
        <Route path="/profile/:chatId/:userId" element={<PublicProfile />} />

        {/* Keep all your existing app routes here */}
        <Route path="/*" element={<RoutesEl />} />
      </Routes>
    </div>
  );
}
