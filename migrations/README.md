# Database migrations

These are the Supabase SQL files, in the order they were applied. For a **fresh
setup**, run them top to bottom in the Supabase Dashboard → SQL Editor. On the
existing live database they've already been run — you only need the ones you
haven't applied yet.

| Order | File | What it adds |
|-------|------|--------------|
| 1 | `supabase-schema.sql` | Core tables: profiles, quests, completions |
| 2 | `supabase-step3.sql` | Macro targets + arabic_foods + food_log |
| 3 | `supabase-step4-final.sql` | daily_bonuses (macro XP awards) |
| 4 | `supabase-step5.sql` | Body/goal fields on profile, `meal` on food_log |
| 5 | `supabase-step6.sql` | custom_barcodes + more seeded foods |
| 6 | `supabase-step7b.sql` | Search-related changes |
| 7 | `supabase-step9.sql` | goal_weight_kg + weight_log |
| 8 | `supabase-step10.sql` | recipes |
| 9 | `supabase-step11-remove-auth.sql` | Drops auth FKs + RLS, opens anon access |
| 10 | `supabase-step12-second-profile.sql` | Seeds the second profile (Hala) |
| 11 | `supabase-step14-water.sql` | water_log + water_goal |
| 12 | `harden-rls.sql` | **Scopes access to the two known profiles** (see file header) |

`harden-rls.sql` is the security tightening — read its header comment before
running it. It limits what the public anon key can touch, but note that a true
"only we can see this" guarantee needs a login, which this app deliberately
doesn't have.
