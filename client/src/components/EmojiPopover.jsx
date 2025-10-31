// src/components/EmojiPopover.jsx

/**
 * EmojiPopover — anchored popover for quick reactions.
 
 */

import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/*
[PRO] Purpose: Lightweight picker for quick emoji reactions anchored to a button.
Context: Opens near the anchor; closes on outside click, ESC, scroll, resize, or app-level modal close.
Edge cases: Missing anchor, offscreen positioning; we clamp to viewport.
Notes: Keep as pure UI; consumer owns state via `open` and `onPick`.
*/

const EMOJIS = [
  "😀","😅","😂","😍","👍","🙏","🔥","🎉","❤️","😢",
  "😮","👎","😉","😎","🥰","😡","👏","🙌","💯","🫶"
];

export default function EmojiPopover({ anchorRef, open, onPick, onClose }) {
  const popRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = () => onClose?.();
    const onKey = (e) => e.key === "Escape" && close();
    const onDown = (e) => {
      const t = e.target;
      if (popRef.current?.contains(t) || anchorRef?.current?.contains(t)) return;
      close();
    };
    const onVis = () => document.visibilityState === "hidden" && close();

    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close, true);
    document.addEventListener("visibilitychange", onVis, true);
    window.addEventListener("app:closeAllModals", close, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close, true);
      document.removeEventListener("visibilitychange", onVis, true);
      window.removeEventListener("app:closeAllModals", close, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !anchorRef?.current) return null;

  const rect = anchorRef.current.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 280 - 8));
  const bottom = Math.max(64, window.innerHeight - rect.top + 8);

  return createPortal(
    <div
      ref={popRef}
      style={{ position: "fixed", left, bottom, zIndex: 1200 }}
      className="w-[280px] rounded-2xl shadow-xl border bg-white p-2"
    >
      <div className="grid grid-cols-8 gap-1">
        {EMOJIS.map((e) => (
          <button
            key={e}
            className="text-xl rounded hover:bg-gray-50 active:scale-95 leading-none"
            onClick={() => {
              onPick?.(e);
              onClose?.();
            }}
            aria-label={`Emoji ${e}`}
            type="button"
          >
            {e}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
