// src/components/EmptyState.jsx

/**
 * EmptyState — simple centered guidance card for the chat screen.

 */

import React from "react";

/*
[PRO] Purpose: Provide a friendly nudge to start a conversation when nothing is selected.
Context: Appears in the right pane until a chat is active.
Edge cases: None; purely presentational.
Notes: Keep minimal styles to fit existing theme.
*/

export default function EmptyState() {
  return (
    <div className="flex items-center justify-center h-full chat-wallpaper">
      <div className="card max-w-md text-center">
        <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M21 12c0 4.418-4.03 8-9 8-1.03 0-2.02-.15-2.94-.43L4 20l1.35-3.31C4.51 15.35 4 13.73 4 12 4 7.582 8.03 4 13 4s8 3.582 8 8Z"
              stroke="#065F46"
              strokeWidth="1.5"
            />
            <circle cx="10" cy="12" r="1" fill="#065F46" />
            <circle cx="13" cy="12" r="1" fill="#065F46" />
            <circle cx="16" cy="12" r="1" fill="#065F46" />
          </svg>
        </div>
        <div className="text-2xl font-semibold text-emerald-900">WhatsApp-style Chat</div>
        <p className="text-gray-600 mt-2">Search a user on the left to start a conversation.</p>
      </div>
    </div>
  );
}
