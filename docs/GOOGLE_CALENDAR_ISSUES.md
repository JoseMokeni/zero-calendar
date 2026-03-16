# Google Calendar Integration — Known Issues

## Current State

Google Calendar is connected via OAuth (scope: `googleapis.com/auth/calendar`) but is **effectively unused**. The code to read/write Google Calendar exists in `lib/google-calendar.ts`, but nothing in the app calls it in a working way.

---

## Issue 1: Events are never synced to Google on create/update/delete

**Location:** `lib/calendar.ts` → `createEvent`, `updateEvent`, `deleteEvent`

**Problem:** These functions only write to Vercel KV. They never call `createGoogleCalendarEvent` from `lib/google-calendar.ts`. So events created in Zero Calendar (via UI or AI chat) never appear in the user's Google Calendar.

**What would need to happen:** After writing to KV, check if the user has Google connected (`userData.provider === "google"` + valid tokens), and call `createGoogleCalendarEvent` / update / delete accordingly.

---

## Issue 2: Manual sync reads from wrong KV key

**Location:** `lib/calendar.ts` → `syncWithGoogleCalendar` (line ~922)

**Problem:** The sync function reads local events from:
```typescript
const localEvents = (await kv.zrange(`events:${userId}`, 0, -1)) as CalendarEvent[]
```
But events are stored at:
```typescript
`user:${userId}:events`  // using lrange, not zrange
```
So `localEvents` is always an empty array, and the sync pushes 0 events to Google.

**Fix:** Change to:
```typescript
const localEvents = await kv.lrange<CalendarEvent>(`user:${userId}:events`, 0, -1)
```

---

## Issue 3: `searchEvents` reads from wrong KV key

**Location:** `lib/calendar.ts` → `searchEvents` (line ~387)

**Problem:** Same as Issue 2 — reads from `events:${userId}` (sorted set) instead of `user:${userId}:events` (list).

```typescript
const allEvents = await kv.zrange(`events:${userId}`, 0, -1)  // wrong key
```

**Fix:** Change to:
```typescript
const allEvents = await kv.lrange<CalendarEvent>(`user:${userId}:events`, 0, -1)
```

---

## Issue 4: Google Calendar events are never fetched into the calendar view

**Location:** `lib/calendar.ts` → `getEvents`

**Problem:** `getEvents` only reads from KV (`user:${userId}:events`). It never calls `getGoogleCalendarEvents` to fetch events from the user's actual Google Calendar. So even if the user has events in Google Calendar, they won't appear in the Zero Calendar UI.

**What would need to happen:** `getEvents` should check if the user has Google connected, fetch Google Calendar events, merge them with local events, and return the combined list (deduplicating by `sourceId`).

---

## Summary of fixes applied (unrelated to Google)

| Fix | File(s) | Bug |
|-----|---------|-----|
| `"use server"` directive | `lib/calendar.ts` | KV calls fail in browser — events can't be created/updated/deleted |
| `session.user.sub` → `.id` | `app/calendar/page.tsx` | Wrong user ID used to fetch events on page load |
| Map categories to names | `app/calendar/page.tsx`, `components/multi-calendar-view.tsx` | Objects rendered as React children crash the EventDialog |
| Deduplicate calendars | `components/sidebar.tsx` | Duplicate keys in sidebar calendar list |
