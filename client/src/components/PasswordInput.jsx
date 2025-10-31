/**
 * PasswordInput — text/password toggle with compact visibility controls.
 */

/*
[PRO] Purpose: Allow users to verify password entries without leaving the field
Context: Reduces friction when typing long passwords on mobile
Edge cases: Screen readers need clear labels; fallback to "password" when hidden
Notes: Keeps styling minimal to blend with existing form inputs
*/

import React, { useState } from "react";

/** inline icons to avoid external deps */
const Eye = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...p}>
    <path d="M12 5C7 5 2.73 8.11 1 12c1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7Zm0 12a5 5 0 1 1 5-5 5 5 0 0 1-5 5Z" fill="currentColor"/>
  </svg>
);
const EyeOff = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...p}>
    <path d="M2 5.27 3.28 4 20 20.72 18.73 22l-2.21-2.21A10.84 10.84 0 0 1 12 19c-5 0-9.27-3.11-11-7a12.44 12.44 0 0 1 4.11-5.13L2 5.27Zm6.54 6.54a3.5 3.5 0 0 0 4.65 4.65l-4.65-4.65ZM12 5c5 0 9.27 3.11 11 7a12.8 12.8 0 0 1-3.06 4.19l-1.42-1.42A10.2 10.2 0 0 0 21 12c-1.73-3.89-6-7-9-7a10 10 0 0 0-4 .84l1.56 1.56A8.24 8.24 0 0 1 12 5Z" fill="currentColor"/>
  </svg>
);

/**
 * @param {Object} props
 * @param {string} props.value
 * @param {(e: React.ChangeEvent<HTMLInputElement>) => void} props.onChange
 * @param {string} [props.placeholder]
 */
export default function PasswordInput({ value, onChange, placeholder = "Password", ...rest }) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <input
        className="w-full border p-3 rounded pr-12"
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded hover:bg-gray-50"
        aria-label={show ? "Hide password" : "Show password"}
        title={show ? "Hide" : "Show"}
      >
        {show ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}
