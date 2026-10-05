import React from "react";
import * as api from "../api.js";
import Settings from "../components/Settings.jsx";
import { SYNC_NOTE } from "./copy.js";

// The desktop Settings, minus the extension (phones can't run it).
const NO_EXTENSION = { checking: false, present: false, connected: false, mismatch: false, isChromium: false };

export default function PhoneSettings({ me, reload, onToast, onRetakeQuiz, removalQueued }) {
  const toggleRemoveFromYoutube = async (enabled) => {
    try {
      await api.setPrefs({ removeFromYoutube: enabled });
      await reload();
    } catch (error) {
      onToast(error.message);
    }
  };
  return (
    <div className="ph-settings">
      <p className="ph-note ph-settings__sync">{SYNC_NOTE}</p>
      <Settings me={me} onBack={() => {}} onToast={onToast} onRetakeQuiz={onRetakeQuiz}
        extension={{ ...NO_EXTENSION, accountEmail: me.email }} onConnectExtension={async () => null}
        extensionBusy={false} extensionConnected={false} extensionVersionOk={false}
        removeFromYoutube={me.removeFromYoutube} onToggleRemoveFromYoutube={toggleRemoveFromYoutube}
        onImportManually={() => {}} historyRemovesFromYoutube={removalQueued} />
    </div>
  );
}
