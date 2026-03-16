# Changes Applied to Forked Repo

---

## 1. Add missing `tsconfig.json` + regenerate `package-lock.json`

**Commit:** `cbc5b7b`

**Problem:** Build fails with `Module not found: Can't resolve '@/components/ui/button'` and similar errors for all `@/*` path aliases (shadcn/ui components, hooks).

**Fix:**
- Create `tsconfig.json` at the project root with the `@/*` path alias pointing to `./*`
- Run `npm install --legacy-peer-deps` to regenerate `package-lock.json`

**Files:**
- `tsconfig.json` (new file)
- `package-lock.json` (regenerated)

---

## 2. Update Next.js to `^15.3.0`

**Commit:** `912c247`

**Problem:** Vercel blocks deployment due to a security vulnerability in Next.js 15.2.4.

**Fix:**
- In `package.json`, change `"next": "15.2.4"` to `"next": "^15.3.0"`
- Run `npm install --legacy-peer-deps` to update the lock file

**Files:**
- `package.json` (`next` version)
- `package-lock.json` (updated)

---

## 3. Add `"use server"` to `lib/calendar.ts`

**Problem:** `lib/calendar.ts` functions (`getEvents`, `createEvent`, `updateEvent`, `deleteEvent`) use `@vercel/kv` which requires `KV_REST_API_URL` and `KV_REST_API_TOKEN` env vars. These are NOT prefixed with `NEXT_PUBLIC_`, so they are `undefined` in the browser. Client components (`event-dialog.tsx`, `multi-calendar-view.tsx`) import and call these functions directly, causing all KV calls to fail silently. Events cannot be created, updated, or deleted from the UI.

**Fix:**
Add `"use server"` at the top of `lib/calendar.ts`. This makes all exported functions server actions — they run server-side and are callable from client components via Next.js RPC.

**Diff:**
```diff
+ "use server"
+
  import { kv } from "@/lib/kv-config"
```

**Files:**
- `lib/calendar.ts` (line 1)

---

## 4. Fix `session.user.sub` → `session.user.id` in calendar page

**Problem:** `app/calendar/page.tsx` uses `session.user.sub` to fetch events and categories, but the NextAuth session callback only sets `session.user.id`. TypeScript also errors because `sub` is not on the session type. While it may work at runtime for Google users (NextAuth auto-sets `sub`), it's incorrect and breaks for credentials-based users.

**Fix:**
Change `session.user.sub` to `session.user.id` on both calls.

**Diff:**
```diff
- const events = await getEvents(session.user.sub as string, startOfMonth, endOfMonth)
- const categories = await getUserCategories(session.user.sub as string)
+ const events = await getEvents(session.user.id, startOfMonth, endOfMonth)
+ const categories = await getUserCategories(session.user.id)
```

**Files:**
- `app/calendar/page.tsx` (lines 20-21)

---

## 5. Fix categories type mismatch (objects rendered as React children)

**Problem:** `getUserCategories` returns `CalendarCategory[]` (objects with `id`, `name`, `color`, etc.), but the `categories` state in `multi-calendar-view.tsx` is typed as `string[]`. When passed to `EventDialog`, the `SelectItem` component receives objects instead of strings, causing: `"Objects are not valid as a React child"`.

**Fix:**
Map `CalendarCategory[]` to `string[]` (extract `.name`) in two places:
1. When passing `initialCategories` prop from the server component
2. When setting state from the client-side fetch

**Diff in `app/calendar/page.tsx`:**
```diff
- <MultiCalendarView initialEvents={events} initialCategories={categories} />
+ <MultiCalendarView initialEvents={events} initialCategories={categories.map((c) => c.name)} />
```

**Diff in `components/multi-calendar-view.tsx`:**
```diff
- setCategories(fetchedCategories || [])
+ setCategories((fetchedCategories || []).map((c) => c.name))
```

**Files:**
- `app/calendar/page.tsx` (line 29)
- `components/multi-calendar-view.tsx` (line 189)

---

## 6. Fix duplicate calendar keys in sidebar

**Problem:** The sidebar's `calendars.map()` renders items with `key={calendar.id}`. If the KV store has duplicate category entries (e.g., two with `id: "personal"`), React warns: `"Encountered two children with the same key"`.

**Fix:**
Deduplicate calendars by `id` after fetching.

**Diff in `components/sidebar.tsx`:**
```diff
  const data = await response.json()
- setCalendars(data.calendars)
+ const seen = new Set()
+ setCalendars(data.calendars.filter((c: Calendar) => !seen.has(c.id) && seen.add(c.id)))
```

**Files:**
- `components/sidebar.tsx` (line 72)
