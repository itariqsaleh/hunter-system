// supabase/functions/nutritionix/index.ts
//
// Barcode (UPC) lookup proxy for Nutritionix. Keeps the app id/key server-side.
//
// Deploy:
//   supabase functions deploy nutritionix
//   supabase secrets set NUTRITIONIX_APP_ID=your_app_id
//   supabase secrets set NUTRITIONIX_APP_KEY=your_app_key
// Then paste the function URL into NUTRITIONIX_PROXY_URL in store.js.
//
// Get free keys at https://developer.nutritionix.com (free tier is small —
// this is a fallback for products Open Food Facts and USDA don't have).

import { serve } from 'https://deno.land/std@0.192.0/http/server.ts';

const APP_ID = Deno.env.get('NUTRITIONIX_APP_ID');
const APP_KEY = Deno.env.get('NUTRITIONIX_APP_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { barcode } = await req.json();
    if (!barcode) return json({ error: 'Missing "barcode" in request body' }, 400);
    if (!APP_ID || !APP_KEY) return json({ product: null }); // not configured — behave as "not found"

    const res = await fetch(
      `https://trackapi.nutritionix.com/v2/search/item?upc=${encodeURIComponent(barcode)}`,
      { headers: { 'x-app-id': APP_ID, 'x-app-key': APP_KEY } }
    );
    if (res.status === 404) return json({ product: null });
    if (!res.ok) return json({ error: 'Nutritionix request failed', status: res.status }, 502);

    const data = await res.json();
    const f = (data.foods || [])[0];
    if (!f) return json({ product: null });

    const name = f.brand_name ? `${f.food_name} (${f.brand_name})` : f.food_name;
    const grams = Number(f.nf_serving_weight_grams) || 0;
    const num = (v: unknown) => Number(v) || 0;

    // Normalize to per-100g when we know the serving weight; otherwise report
    // the values per serving and let the app scale by quantity.
    const product = grams > 0
      ? {
          name, mode: 'per100g',
          calories: Math.round((num(f.nf_calories) * 100) / grams),
          protein: Math.round(((num(f.nf_protein) * 100) / grams) * 10) / 10,
          carbs: Math.round(((num(f.nf_total_carbohydrate) * 100) / grams) * 10) / 10,
          fat: Math.round(((num(f.nf_total_fat) * 100) / grams) * 10) / 10
        }
      : {
          name, mode: 'perServing',
          servingLabel: `${f.serving_qty || 1} ${f.serving_unit || 'serving'}`,
          calories: Math.round(num(f.nf_calories)),
          protein: Math.round(num(f.nf_protein) * 10) / 10,
          carbs: Math.round(num(f.nf_total_carbohydrate) * 10) / 10,
          fat: Math.round(num(f.nf_total_fat) * 10) / 10
        };

    return json({ product });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
