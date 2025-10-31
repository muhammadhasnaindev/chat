/**
 * TypingDots — minimal animated typing indicator (no emoji/glyphs).

 */

/*
[PRO] Purpose: Show lightweight typing feedback without loading images or emoji.
Context: Prior code used glyph bullets; this switches to pure CSS circles for consistency.
Edge cases: Respects parent text color via `currentColor`; animation staggered with delays.
Notes: Keep the container inline to align with message text where used.
*/

/**
 * @returns {JSX.Element}
 */
import React from "react";

export default function TypingDots() {
  return (
    <div className="inline-flex gap-1 p-2 text-gray-600" aria-label="Typing">
      <span
        aria-hidden="true"
        className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce"
        style={{ animationDelay: "0ms" }}
      />
      <span
        aria-hidden="true"
        className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce"
        style={{ animationDelay: "150ms" }}
      />
      <span
        aria-hidden="true"
        className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-bounce"
        style={{ animationDelay: "300ms" }}
      />
    </div>
  );
}
