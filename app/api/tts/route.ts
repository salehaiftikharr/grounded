// Grounded voice layer: server-side proxy to the ElevenLabs Text-to-Speech API.
//
// The API key stays on the server (never shipped to the browser). The client
// POSTs { text } here, we call ElevenLabs, and stream the audio back.
//
// Assumes Next.js App Router (app/ directory). If Grounded uses the Pages
// Router, see INTEGRATION.md for the pages/api/tts.ts variant.

import { NextRequest } from "next/server";

// Default voice: "Sarah", one of ElevenLabs' current default voices, which
// (unlike the community Voice Library) is usable via the API on the free tier.
// Override with ELEVENLABS_VOICE_ID to pick another voice.
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

// Flash v2.5 is the low-latency model (~75ms), which keeps the spoken answer
// feeling responsive. Swap to "eleven_multilingual_v2" for higher fidelity.
const MODEL_ID = "eleven_flash_v2_5";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ELEVENLABS_API_KEY is not set on the server." },
      { status: 500 }
    );
  }

  let text: string;
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text.trim() : "";
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!text) {
    return Response.json({ error: "Missing 'text' in request body." }, { status: 400 });
  }

  // Guardrail: cap length so a runaway answer cannot burn credits. Grounded
  // answers are short, so this is a generous ceiling.
  if (text.length > 5000) {
    text = text.slice(0, 5000);
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

  const elevenRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    }
  );

  if (!elevenRes.ok || !elevenRes.body) {
    const detail = await elevenRes.text().catch(() => "");
    return Response.json(
      { error: "ElevenLabs request failed.", status: elevenRes.status, detail },
      { status: 502 }
    );
  }

  // Stream the audio straight through to the client.
  return new Response(elevenRes.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
