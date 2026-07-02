// Grounded voice layer: a small React hook for the two voice pieces.
//
//   speak(text)      -> plays a grounded answer aloud via the /api/tts route
//   startListening() -> captures a spoken question with the browser's
//   stopListening()     SpeechRecognition, calling back with the transcript
//
// Voice input uses the browser Web Speech API to keep the first pass simple
// and dependency-free. Later we can route input through ElevenLabs Scribe
// (speech-to-text) so the whole loop runs on their stack; see INTEGRATION.md.

import { useCallback, useEffect, useRef, useState } from "react";

// SpeechRecognition is vendor-prefixed in some browsers and typed loosely here
// because it is not in the standard lib DOM types.
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  return new Ctor() as SpeechRecognitionLike;
}

export function useVoice() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const sttSupported =
    typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  // Speak a grounded answer (or an honest refusal) aloud.
  const speak = useCallback(
    async (text: string) => {
      if (!text?.trim()) return;
      setError(null);
      cleanupAudio();
      setIsSpeaking(true);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(detail?.error || `TTS failed (${res.status})`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => setIsSpeaking(false);
        audio.onerror = () => {
          setError("Could not play audio.");
          setIsSpeaking(false);
        };
        await audio.play();
      } catch (e: any) {
        setError(e?.message || "Something went wrong generating speech.");
        setIsSpeaking(false);
      }
    },
    [cleanupAudio]
  );

  const stopSpeaking = useCallback(() => {
    cleanupAudio();
    setIsSpeaking(false);
  }, [cleanupAudio]);

  // Capture a spoken question. onTranscript fires with the final transcript.
  const startListening = useCallback(
    (onTranscript: (transcript: string) => void) => {
      const recognition = getSpeechRecognition();
      if (!recognition) {
        setError("Voice input is not supported in this browser. Try Chrome.");
        return;
      }
      setError(null);
      recognition.lang = "en-US";
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.onresult = (event: any) => {
        const transcript = event?.results?.[0]?.[0]?.transcript ?? "";
        if (transcript) onTranscript(transcript);
      };
      recognition.onerror = (event: any) => {
        setError(event?.error ? `Voice input error: ${event.error}` : "Voice input error.");
        setIsListening(false);
      };
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
    },
    []
  );

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  useEffect(() => {
    return () => {
      cleanupAudio();
      recognitionRef.current?.stop();
    };
  }, [cleanupAudio]);

  return {
    speak,
    stopSpeaking,
    isSpeaking,
    startListening,
    stopListening,
    isListening,
    sttSupported,
    error,
  };
}
