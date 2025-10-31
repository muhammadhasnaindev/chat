// client/src/components/BackButton.jsx

/**
 * Back button with mobile double-tap guard and optional styling.

 */

import React, { useRef } from "react";
import { useNavigate } from "react-router-dom";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";

/*
[PRO] Purpose: Provide a consistent back control that works across modals and pages.
Context: Some screens render inside portals/modals; we close them before navigating.
Edge cases: Double taps on touch can fire twice; we use a simple ref guard with short timeout.
Notes: If history is shallow, we fallback to a target route.
*/

/**
 * BackButton
 * @param {{
 *  className?: string,
 *  to?: string,
 *  label?: string,
 *  onBack?: ()=>void,
 *  tone?: "green" | "outline"
 * }} props
 */
export default function BackButton({
  className = "",
  to = "/",
  label = "Back",
  onBack,
  tone = "green",
}) {
  const navigate = useNavigate();
  const firedRef = useRef(false);

  const go = () => {
    if (firedRef.current) return;
    firedRef.current = true;

    // Close any app-level modals first
    try {
      window.dispatchEvent(new CustomEvent("app:closeAllModals"));
    } catch {}

    setTimeout(() => {
      const hasModal =
        document.body?.dataset?.modalOpen === "1" ||
        !!document.querySelector('[data-portal-owner="app"]');

      if (!hasModal) {
        if (window.history.state && window.history.length > 1) {
          navigate(-1);
        } else {
          navigate(to);
        }
        if (typeof onBack === "function") onBack();
      }

      firedRef.current = false;
    }, 20);
  };

  const baseStyle = {
    minHeight: 40,
    padding: "8px 12px",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    borderRadius: 12,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1,
    cursor: "pointer",
  };

  const style =
    tone === "green"
      ? {
          ...baseStyle,
          backgroundColor: "#059669", // emerald-600
          color: "#ffffff",
          border: "1px solid #047857", // emerald-700
          boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
        }
      : {
          ...baseStyle,
          backgroundColor: "#ffffff",
          color: "#111827",
          border: "1px solid rgba(0,0,0,0.12)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        };

  return (
    <button
      onClick={go}
      onTouchEnd={(e) => {
        e.preventDefault();
        go();
      }}
      aria-label={label}
      title={label}
      className={`select-none ${className}`}
      style={style}
      type="button"
    >
      <ArrowBackIosNewIcon fontSize="small" />
      <span>{label}</span>
    </button>
  );
}
