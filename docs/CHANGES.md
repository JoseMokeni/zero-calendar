# Zero Calendar — Bug Fixes & Improvements

## Summary

**7 bug fixes** — app couldn't build, events couldn't be created/updated/deleted, calendar page crashed, AI chat ignored events without a title.

**6 Google Calendar improvements** — credentials are now persisted, events are fetched from Google and displayed, and all CRUD operations (create, update, delete) sync bidirectionally with Google Calendar.

> **Note on upstream compatibility:** Most changes are safe to carry forward, but `lib/calendar.ts` and `lib/auth.ts` are core files that the upstream repo will likely modify. When pulling future updates from zero-calendar, expect merge conflicts in those two files. The conflicts should be straightforward to resolve — our additions are clearly scoped blocks (Google sync at the end of CRUD functions, credential storage in the JWT callback). Lower-risk changes (tsconfig, Next.js version, sidebar dedup, AI default title) are unlikely to conflict.

---

## Bug Fixes

### 1. Missing `tsconfig.json` — build fails on all `@/*` imports

**Commit:** `cbc5b7b`

**Symptom:** `npm run build` fails with `Module not found: Can't resolve '@/components/ui/button'` and similar errors for every `@/*` path alias.

**Cause:** The repo was missing `tsconfig.json`, so Next.js couldn't resolve `@/*` imports to the project root.

**Fix:** Add `tsconfig.json` with the `@/*` → `./*` path alias. Regenerate `package-lock.json` with `npm install --legacy-peer-deps`.

**Files:** `tsconfig.json` (new), `package-lock.json`

---

### 2. Next.js security vulnerability blocks Vercel deployment

**Commit:** `912c247`

**Symptom:** Vercel refuses to deploy — flags Next.js 15.2.4 as vulnerable.

**Fix:** Update `"next": "15.2.4"` → `"next": "^15.3.0"` in `package.json`, then `npm install --legacy-peer-deps`.

**Files:** `package.json`, `package-lock.json`

---

### 3. Calendar CRUD broken — KV calls fail in the browser

**Symptom:** Creating, updating, or deleting events silently fails. No errors shown to the user, but nothing is saved.

**Cause:** `lib/calendar.ts` uses `@vercel/kv` which needs `KV_REST_API_URL` and `KV_REST_API_TOKEN` env vars. These are server-only (not `NEXT_PUBLIC_`), so they're `undefined` when client components call these functions directly.

**Fix:** Add `"use server"` at the top of `lib/calendar.ts`. This turns all exported functions into Next.js server actions — they execute server-side even when called from client components.

**Files:** `lib/calendar.ts` (line 1)

---

### 4. Wrong user ID on calendar page — `session.user.sub` vs `.id`

**Symptom:** Events and categories may not load on the calendar page, or load for the wrong user.

**Cause:** `app/calendar/page.tsx` uses `session.user.sub`, but the NextAuth session callback only sets `session.user.id`.

**Fix:** Replace `session.user.sub` with `session.user.id`.

**Files:** `app/calendar/page.tsx`

---

### 5. Categories crash the event dialog — objects rendered as React children

**Symptom:** Opening the event dialog throws: `"Objects are not valid as a React child"`. The category dropdown is broken.

**Cause:** `getUserCategories` returns objects (`{ id, name, color, ... }`), but the component expects plain strings. The `SelectItem` tries to render the full object.

**Fix:** Map category objects to their `.name` string in two places:
- `app/calendar/page.tsx` — when passing `initialCategories` prop
- `components/multi-calendar-view.tsx` — when setting state from client-side fetch

**Files:** `app/calendar/page.tsx`, `components/multi-calendar-view.tsx`

---

### 6. Duplicate calendar keys in sidebar

**Symptom:** React warning: `"Encountered two children with the same key: personal"`.

**Cause:** The KV store contains duplicate calendar entries with the same `id`.

**Fix:** Deduplicate calendars by `id` after fetching in `components/sidebar.tsx`.

**Files:** `components/sidebar.tsx`

---

### 7. AI chat ignores event creation when no title is provided

**Symptom:** Saying "create an event tomorrow at 10 AM" (without a title) logs `Missing required fields for create_event intent` and falls back to general chat. No event is created.

**Cause:** The intent parser in `app/api/ai/chat/route.ts` treats a missing title as invalid and rejects the whole intent.

**Fix:** Default to `"New Event"` when the LLM returns a `create_event` intent without a title, instead of rejecting the intent.

**Files:** `app/api/ai/chat/route.ts`

---

## Google Calendar Improvements

### 8. Google credentials never stored — sync impossible

**Symptom:** Google Calendar shows as "not connected" in settings, and no sync occurs, even after signing in with Google.

**Cause:** The NextAuth JWT callback stored Google OAuth tokens (`accessToken`, `refreshToken`, `expiresAt`) only in the browser session/JWT. But all Google Calendar functions read credentials from Vercel KV (`kv.hgetall("user:${userId}")`), which was always empty.

**Fix:** In the JWT callback (`lib/auth.ts`), persist Google credentials to KV on sign-in when `account.provider === "google"`.

**Files:** `lib/auth.ts`

---

### 9. Google Calendar events now appear in the calendar view

**Symptom:** Even with Google connected, no Google Calendar events appeared in Zero Calendar.

**Cause:** `getEvents` in `lib/calendar.ts` only read from KV (local events). It never called `getGoogleCalendarEvents`.

**Fix:** After fetching local events, check if the user has Google credentials and fetch + merge Google Calendar events into the result.

**Files:** `lib/calendar.ts` (`getEvents` function)

---

### 10. New events now sync to Google Calendar on creation

**Symptom:** Events created in Zero Calendar (via UI or AI chat) never appeared in Google Calendar.

**Cause:** `createEvent` only wrote to KV. It never called `createGoogleCalendarEvent`.

**Fix:** After saving to KV, check for Google credentials and push the event to Google Calendar.

**Files:** `lib/calendar.ts` (`createEvent` function)

---

### 11. Event updates sync to Google Calendar

**Symptom:** Editing a Google Calendar event in Zero Calendar didn't update it on Google's side.

**Fix:** After updating in KV, sync the change to Google Calendar if the event has a `google_` ID prefix.

**Files:** `lib/calendar.ts` (`updateEvent` function)

---

### 12. Event deletes sync to Google Calendar

**Symptom:** Deleting a Google Calendar event in Zero Calendar didn't remove it from Google's side.

**Fix:** After removing from KV, delete from Google Calendar if the event has a `google_` ID prefix.

**Files:** `lib/calendar.ts` (`deleteEvent` function)

---

### 13. All-day events from Google no longer crash the cache

**Symptom:** `storeGoogleEventsInDatabase` throws `ERR null args are not supported` when caching birthday/all-day events from Google.

**Cause:** All-day Google events use `start.date` instead of `start.dateTime`, so `new Date(event.start).getTime()` returns `NaN`, which becomes `null` in the `zadd` call.

**Fix:** Skip events with `NaN` scores (invalid dates) when caching.

**Files:** `lib/google-calendar.ts` (`storeGoogleEventsInDatabase` function)
