"use client";

// Grounded voice layer: drop-in UI controls built on the shadcn Button.
//
//   <MicButton onQuestion={...} />  next to the question input
//   <SpeakAnswer text={answer} />   next to a rendered answer or refusal

import { useEffect, useState } from "react";
import { Mic, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <Button
      type="button"
      variant={isListening ? "default" : "secondary"}
      disabled={disabled}
      aria-pressed={isListening}
      aria-label={isListening ? "Stop listening" : "Ask by voice"}
      title={error || undefined}
      onClick={() => (isListening ? stopListening() : startListening(onQuestion))}
    >
      {isListening ? (
        <>
          <Square className="size-3 fill-current" /> Listening
        </>
      ) : (
        <>
          <Mic className="size-4" /> Voice
        </>
      )}
    </Button>
  );
}

// A button that speaks a grounded answer (or an honest refusal) aloud.
export function SpeakAnswer({ text }: { text: string }) {
  const { speak, stopSpeaking, isSpeaking, error } = useVoice();

  if (!text?.trim()) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      aria-label={isSpeaking ? "Stop" : "Hear this answer"}
      title={error || undefined}
      onClick={() => (isSpeaking ? stopSpeaking() : speak(text))}
    >
      {isSpeaking ? (
        <>
          <Square className="size-3 fill-current" /> Stop
        </>
      ) : (
        <>
          <Volume2 className="size-4" /> Hear this
        </>
      )}
    </Button>
  );
}
