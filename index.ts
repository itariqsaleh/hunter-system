// supabase/functions/macro-chat/index.ts
//
// Deploy with the Supabase CLI:
//   supabase functions deploy macro-chat
//   supabase secrets set GEMINI_API_KEY=your_key_here
//
// By default Supabase requires a valid Authorization header (checked by
// the platform itself, before this code even runs) — so only signed-in
// users of your app can call this. The Gemini key lives only in Supabase's
// secret store, never in any file you deploy to GitHub Pages/Netlify.

import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const SYSTEM_PROMPT =
  "You are a concise, friendly nutrition and fitness coach embedded in a gamified habit-tracking app. " +
  "Answer questions about macros, calories, food choices, and workouts directly and briefly (2-5 sentences). " +
  "If asked for specific numbers (e.g. protein in a food), give your best estimate and say it's approximate. " +
  "Do not give medical diagnoses or advice for eating disorders or illegal substances.";

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { message } = await req.json();
    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing "message" in request body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = {
      contents: [{ role: 'user', parts: [{ text: message }] }],
      systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: { temperature: 0.4, maxOutputTokens: 400 }
    };

    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!geminiRes.ok) {
      const detail = await geminiRes.text();
      return new Response(JSON.stringify({ error: 'Gemini request failed', detail }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const geminiData = await geminiRes.json();
    const reply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text
      || "Sorry, I couldn't generate a response for that.";

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
