import React from "react";

export default function PrivateScreen({ onSignOut }) {
  return (
    <div className="empty-hero">
      <h2>This Laterlist is private.</h2>
      <p>Only its owner can sign in.</p>
      <button className="btn btn--ghost" onClick={onSignOut}>Sign out</button>
    </div>
  );
}
