# WoRxshift

Pharmacist coverage scheduling for Beebe Drug, Vilonia Family Pharmacy, and Amity Road Pharmacy. One or two floating pharmacists move between the three stores; everyone else needs to see where they'll be.

## Who does what

| Role | Can do |
|---|---|
| Manager (the scheduler) | Make schedule (two weeks at a time), edit or remove a shift, approve new accounts, mark floaters, approve or deny time off, notify everyone |
| Floating pharmacist | See the schedule, filter to My shifts, request time off, withdraw a pending request |
| Store pharmacist | See the schedule |

These rules are enforced by the database, not just hidden in the app. See `supabase/schema.sql`.

## Technology

React 18 and Vite 5, hosted on Vercel. Supabase for login, the Postgres database, and one Edge Function (`send-push`) that delivers phone notifications. Installable to a phone's home screen as a web app.

## Files

```
index.html                     page shell, icons, manifest link
public/sw.js                   service worker: shows notifications
public/manifest.webmanifest    home-screen install settings
public/icon-*.png              app icons
src/main.jsx                   startup and crash screen
src/App.jsx                    screens, data loading, saving
src/components/                calendar views, editors, panels
src/push.js                    notification subscribe / unsubscribe / send
src/utils.js                   date helpers and error messages
supabase/schema.sql            the complete database
supabase/functions/send-push/  the notification function
```

## Environment variables

Set in Vercel (Settings → Environment Variables), then redeploy. Values are baked in at build time.

| Name | What it is | Safe in the browser |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL | Yes |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key | Yes — the database rules protect the data |
| `VITE_VAPID_PUBLIC_KEY` | Public half of the notification key pair | Yes |

Set in Supabase (Edge Functions → Secrets), never in Vercel:

| Name | What it is |
|---|---|
| `VAPID_PUBLIC_KEY` | Same public key as above |
| `VAPID_PRIVATE_KEY` | Private half. Never share, never put in a `VITE_` variable |
| `VAPID_SUBJECT` | `mailto:` plus a contact email |

The Supabase service-role key is never used by the app. The Edge Function receives it automatically.

## Setting up from nothing

1. Create a Supabase project. SQL Editor → paste `supabase/schema.sql` → Run.
2. Edit the last line of that file first, or afterward change `allowed_domains` in Table Editor, to the pharmacy's email domain.
3. Authentication → Sign In / Providers → Email → turn off "Confirm email."
4. Authentication → URL Configuration → set Site URL and add a Redirect URL, both the live app address. Password reset links fail without this.
5. Authentication → turn on leaked-password protection.
6. Authentication → Emails → SMTP → connect a real sender (such as Resend). Supabase's built-in email is limited to a few messages an hour.
7. Deploy the function in `supabase/functions/send-push` and set its three secrets.
8. Connect the GitHub repo in Vercel, add the three `VITE_` variables, deploy.
9. Sign up with your own work email, then in SQL Editor:
   ```sql
   update public.profiles set role = 'manager', approved = true
   where id = (select id from auth.users where email = 'you@example.com');
   ```

## Onboarding the pharmacy

1. Everyone opens the site and taps "I need an account" with their work email.
2. The manager opens Pharmacists, approves each person.
3. For each floater, Edit → "Do they float between stores?" → Yes. Only floaters can be scheduled.
4. Promote the pharmacy's scheduler to Manager. There must always be at least one manager; the database refuses to remove the last one.
5. On iPhone, each person adds the site to their home screen before turning on notifications.

## Database rules worth knowing

- A shift's end must be after its start. Overnight shifts are not supported.
- One pharmacist cannot have overlapping shifts. Exact duplicates are overlaps.
- Only active, approved floaters can be assigned.
- Make schedule saves two weeks in one all-or-nothing database call (`save_schedule_period`).
- Time-off reasons are stored separately and are readable only by the requester and managers.
- Every shift records who created it and who last changed it.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Not connected yet" screen | `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` missing, or added without redeploying |
| Signup says to use a work email | The domain isn't in `allowed_domains` |
| Password reset link goes nowhere | Site URL / Redirect URLs not set in Supabase |
| Reset email never arrives | No custom SMTP; built-in email is rate-limited |
| Notifications never arrive | Check Supabase → Edge Functions → send-push → Logs. "VAPID secrets are not set" or "No devices registered" tell you which half is missing |
| iPhone never asks about notifications | The site must be opened from the home-screen icon, not Safari |
| Manager sees nobody to schedule | Nobody is marked as a floater yet |

## Not yet done

- No automated tests, lint, or lockfile. Add `package-lock.json` by running `npm install` once on any machine and committing the result.
- Push notifications have not been tested on a real device.
