"use client";

// Grounded voice layer: drop-in UI controls, styled to match Grounded.
//
//   <MicButton onQuestion={...} />  next to the question input
//   <SpeakAnswer text={answer} />   next to a rendered answer or refusal
//
// Styling comes from the `.voice-*` classes in globals.css so these stay
// consistent with the rest of the dark UI.

import { useEffect, useState } from "react";
import { useVoice } from "../lib/useVoice";

// Voice features depend on browser-only APIs (SpeechRecognition, Audio), so
// these controls render nothing until after the first client mount. That keeps
// the server and initial client markup identical and avoids hydration errors.
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

// A mic button that fills the question box with a spoken question.
export function MicButton({
  onQuestion,
  disabled,
}: {
  onQuestion: (question: string) => void;
  disabled?: boolean;
}) {
  const { startListening, stopListening, isListening, sttSupported, error } = useVoice();
  const mounted = useMounted();

  if (!mounted) return null; // Avoid SSR/client hydration mismatch.
  if (!sttSupported) return null; // Hide gracefully where the browser cannot listen.

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={isListening}
        aria-label={isListening ? "Stop listening" : "Ask by voice"}
        className={`voice-btn mic ${isListening ? "listening" : ""}`}
        onClick={() => (isListening ? stopListening() : startListening(onQuestion))}
      >
        {isListening ? "● Listening…" : "🎤 Voice"}
      </button>
      {error && <span className="voice-error">{error}</span>}
    </>
  );
}

// A button that speaks a grounded answer (or an honest refusal) aloud.
export function SpeakAnswer({ text }: { text: string }) {
  const { speak, stopSpeaking, isSpeaking, error } = useVoice();

  if (!text?.trim()) return null;

  return (
    <span className="voice-speak">
      <button
        type="button"
        aria-label={isSpeaking ? "Stop" : "Hear this answer"}
        className={`voice-btn speak ${isSpeaking ? "speaking" : ""}`}
        onClick={() => (isSpeaking ? stopSpeaking() : speak(text))}
      >
        {isSpeaking ? "◼ Stop" : "🔊 Hear this"}
      </button>
      {error && <span className="voice-error">{error}</span>}
    </span>
  );
}
