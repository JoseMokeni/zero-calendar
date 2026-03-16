"use server"

import { kv } from "@/lib/kv-config"
import { nanoid } from "nanoid"
import { format } from "date-fns-tz"
import { parseISO, addMinutes } from "date-fns"
import { createGoogleCalendarEvent, getGoogleCalendarEvents, updateGoogleCalendarEvent, deleteGoogleCalendarEvent } from "./google-calendar"
import ical from "ical-generator"
import { v4 as uuidv4 } from "uuid"
import { RRule } from "rrule"


export type RecurrenceRule = {
  frequency: "daily" | "weekly" | "monthly" | "yearly"
  interval: number
  count?: number
  until?: string
  byDay?: string[]
  byMonthDay?: number[]
  byMonth?: number[]
  bySetPos?: number[]
  weekStart?: string
  exceptions?: string[]
}

export type CalendarEvent = {
  id: string
  title: string
  description?: string
  start: string
  end: string
  allDay: boolean
  location?: string
  color?: string
  categoryId?: string
  userId: string
  recurring?: {
    frequency: "daily" | "weekly" | "monthly" | "yearly"
    interval: number
    endDate?: string
    count?: number
  }
  source?: "google" | "local" | "microsoft"
  sourceId?: string
  recurrence?: RecurrenceRule
  exceptions?: {
    date: string
    status: "cancelled" | "modified"
    modifiedEvent?: Omit<CalendarEvent, "id" | "userId" | "recurrence" | "exceptions">
  }[]
  attendees?: { email: string; name?: string; status?: "accepted" | "declined" | "tentative" | "needs-action" }[]
  categories?: string[]
  reminders?: { minutes: number; method: "email" | "popup" }[]
  timezone?: string
  isRecurring?: boolean
  isShared?: boolean
  sharedBy?: string
  sharedWith?: string[]
  isRecurringInstance?: boolean
  originalEventId?: string
  exceptionDate?: string
}

export type CalendarCategory = {
  id: string
  name: string
  color: string
  userId: string
  visible: boolean
}

async function getGoogleCredentials(userId: string) {
  const userData = await kv.hgetall(`user:${userId}`)
  console.log("[Google] Checking credentials for user:", userId)
  console.log("[Google] KV user data keys:", userData ? Object.keys(userData) : "null")
  console.log("[Google] provider:", userData?.provider, "hasAccessToken:", !!userData?.accessToken, "hasRefreshToken:", !!userData?.refreshToken)
  if (userData?.provider === "google" && userData?.accessToken && userData?.refreshToken) {
    return {
      accessToken: userData.accessToken as string,
      refreshToken: userData.refreshToken as string,
      expiresAt: userData.expiresAt as number,
    }
  }
  return null
}


function recurrenceRuleToRRuleOptions(rule: RecurrenceRule, eventStart: Date): RRule.Options {
  const options: RRule.Options = {
    freq: {
      daily: RRule.DAILY,
      weekly: RRule.WEEKLY,
      monthly: RRule.MONTHLY,
      yearly: RRule.YEARLY,
    }[rule.frequency],
    interval: rule.interval,
    dtstart: eventStart,
  }

  if (rule.count) {
    options.count = rule.count
  }

  if (rule.until) {
    options.until = new Date(rule.until)
  }

  if (rule.byDay) {
    options.byweekday = rule.byDay.map((day) => {
      const dayMap: Record<string, number> = {
        MO: RRule.MO,
        TU: RRule.TU,
        WE: RRule.WE,
        TH: RRule.TH,
        FR: RRule.FR,
        SA: RRule.SA,
        SU: RRule.SU,
      }
      return dayMap[day]
    })
  }

  if (rule.byMonthDay) {
    options.bymonthday = rule.byMonthDay
  }

  if (rule.byMonth) {
    options.bymonth = rule.byMonth
  }

  if (rule.bySetPos) {
    options.bysetpos = rule.bySetPos
  }

  if (rule.weekStart) {
    options.wkst = {
      MO: RRule.MO,
      TU: RRule.TU,
      WE: RRule.WE,
      TH: RRule.TH,
      FR: RRule.FR,
      SA: RRule.SA,
      SU: RRule.SU,
    }[rule.weekStart]
  }

  return options
}


function generateRecurringInstances(
  event: CalendarEvent,
  startRange: Date,
  endRange: Date,
  timezone: string,
): CalendarEvent[] {
  if (!event.recurrence) return [event]

  const eventStart = parseISO(event.start)
  const eventEnd = parseISO(event.end)
  const duration = eventEnd.getTime() - eventStart.getTime()

  const rruleOptions = recurrenceRuleToRRuleOptions(event.recurrence, eventStart)
  const rule = new RRule(rruleOptions)


  const occurrences = rule.between(startRange, endRange, true)


  const instances = occurrences.map((date) => {
    const instanceStart = new Date(date)
    const instanceEnd = new Date(instanceStart.getTime() + duration)


    const exceptionDate = event.exceptions?.find((ex) => {
      const exDate = parseISO(ex.date)
      return (
        exDate.getFullYear() === instanceStart.getFullYear() &&
        exDate.getMonth() === instanceStart.getMonth() &&
        exDate.getDate() === instanceStart.getDate()
      )
    })


    if (exceptionDate?.status === "cancelled") {
      return null
    }


    if (exceptionDate?.status === "modified" && exceptionDate.modifiedEvent) {
      return {
        ...event,
        id: `${event.id}_${format(instanceStart, "yyyyMMdd")}`,
        start: exceptionDate.modifiedEvent.start,
        end: exceptionDate.modifiedEvent.end,
        title: exceptionDate.modifiedEvent.title || event.title,
        description: exceptionDate.modifiedEvent.description || event.description,
        location: exceptionDate.modifiedEvent.location || event.location,
        color: exceptionDate.modifiedEvent.color || event.color,
        isRecurringInstance: true,
        originalEventId: event.id,
        exceptionDate: exceptionDate.date,
      }
    }


    return {
      ...event,
      id: `${event.id}_${format(instanceStart, "yyyyMMdd")}`,
      start: instanceStart.toISOString(),
      end: instanceEnd.toISOString(),
      isRecurringInstance: true,
      originalEventId: event.id,
    }
  })


  return instances.filter(Boolean) as CalendarEvent[]
}


export async function getUserTimezone(userId: string): Promise<string> {
  const userData = await kv.hgetall(`user:${userId}`)
  return (userData?.timezone as string) || "UTC"
}


function adjustEventTimezone(event: CalendarEvent, fromTimezone: string, toTimezone: string): CalendarEvent {
  if (fromTimezone === toTimezone || event.allDay) {
    return event
  }

  try {
    const startDate = new Date(event.start)
    const endDate = new Date(event.end)


    return {
      ...event,
      timezone: toTimezone,
    }
  } catch (error) {
    console.error("Error adjusting event timezone:", error)
    return event
  }
}


function convertToUTC(date: Date, timezone: string): Date {

  const dateString = date.toISOString()


  const localDate = new Date(dateString)


  const tzOffset = getTimezoneOffset(localDate, timezone)


  const utcDate = new Date(localDate.getTime() - tzOffset * 60000)

  return utcDate
}


function getTimezoneOffset(date: Date, timezone: string): number {

  const dateString = date.toISOString()


  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  })


  const formattedParts = formatter.formatToParts(date)


  const components: Record<string, number> = {}
  formattedParts.forEach((part) => {
    if (part.type !== "literal") {
      components[part.type] = Number.parseInt(part.value, 10)
    }
  })


  const localDate = new Date(
    components.year,
    components.month - 1,
    components.day,
    components.hour,
    components.minute,
    components.second || 0,
  )


  const offset = (date.getTime() - localDate.getTime()) / 60000

  return offset
}

export async function getEvents(userId: string, start: Date, end: Date): Promise<CalendarEvent[]> {
  try {

    const events = await kv.lrange<CalendarEvent>(`user:${userId}:events`, 0, -1)

    const filtered = events.filter((event) => {
      const eventStart = new Date(event.start)
      return eventStart >= start && eventStart <= end
    })

    const creds = await getGoogleCredentials(userId)
    if (creds) {
      try {
        const googleEvents = await getGoogleCalendarEvents(userId, creds.accessToken, creds.refreshToken, creds.expiresAt, start, end)
        filtered.push(...googleEvents)
      } catch (err) {
        console.error("[Calendar] Failed to fetch Google events:", err)
      }
    }

    return filtered
  } catch (error) {
    console.error("Error fetching events:", error)
    throw new Error("Failed to fetch events")
  }
}

export async function createEvent(event: Omit<CalendarEvent, "id">): Promise<CalendarEvent> {
  try {

    console.log(
      "[Calendar] Creating event with details:",
      JSON.stringify({
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
      }),
    )


    const startTime = new Date(event.start)
    const endTime = new Date(event.end)

    console.log("[Calendar] Start time:", startTime.toISOString())
    console.log("[Calendar] End time:", endTime.toISOString())

    const newEvent: CalendarEvent = {
      ...event,
      id: nanoid(),

      start: startTime.toISOString(),
      end: endTime.toISOString(),
    }


    await kv.rpush(`user:${event.userId}:events`, newEvent)

    console.log("[Calendar] Event created successfully:", newEvent.id)
    console.log("[Calendar] Final start time:", newEvent.start)
    console.log("[Calendar] Final end time:", newEvent.end)

    const creds = await getGoogleCredentials(event.userId)
    if (creds) {
      await createGoogleCalendarEvent(event.userId, creds.accessToken, creds.refreshToken, creds.expiresAt, newEvent).catch((err) =>
        console.error("[Calendar] Failed to sync to Google:", err)
      )
    }

    return newEvent
  } catch (error) {
    console.error("Error creating event:", error)
    throw new Error("Failed to create event")
  }
}

export async function updateEvent(event: CalendarEvent): Promise<CalendarEvent> {
  try {

    const events = await kv.lrange<CalendarEvent>(`user:${event.userId}:events`, 0, -1)
    const updatedEvents = events.map((e) => (e.id === event.id ? event : e))

    await kv.del(`user:${event.userId}:events`)
    if (updatedEvents.length > 0) {
      await kv.rpush(`user:${event.userId}:events`, ...updatedEvents)
    }

    if (event.id.startsWith("google_")) {
      const creds = await getGoogleCredentials(event.userId)
      if (creds) {
        await updateGoogleCalendarEvent(event.userId, creds.accessToken, creds.refreshToken, creds.expiresAt, event).catch((err) =>
          console.error("[Calendar] Failed to sync update to Google:", err)
        )
      }
    }

    return event
  } catch (error) {
    console.error("Error updating event:", error)
    throw new Error("Failed to update event")
  }
}

export async function deleteEvent(userId: string, eventId: string): Promise<void> {
  try {

    const events = await kv.lrange<CalendarEvent>(`user:${userId}:events`, 0, -1)
    const filteredEvents = events.filter((e) => e.id !== eventId)

    await kv.del(`user:${userId}:events`)
    if (filteredEvents.length > 0) {
      await kv.rpush(`user:${userId}:events`, ...filteredEvents)
    }

    if (eventId.startsWith("google_")) {
      const creds = await getGoogleCredentials(userId)
      if (creds) {
        await deleteGoogleCalendarEvent(userId, creds.accessToken, creds.refreshToken, creds.expiresAt, eventId).catch((err) =>
          console.error("[Calendar] Failed to sync delete to Google:", err)
        )
      }
    }
  } catch (error) {
    console.error("Error deleting event:", error)
    throw new Error("Failed to delete event")
  }
}


export async function searchEvents(userId: string, query: string): Promise<CalendarEvent[]> {

  const allEvents = await kv.lrange<CalendarEvent>(`user:${userId}:events`, 0, -1)


  const timezone = await getUserTimezone(userId)


  const queryLower = query.toLowerCase()
  const matchingEvents = allEvents.filter((event: any) => {
    return (
      event.title.toLowerCase().includes(queryLower) ||
      (event.description && event.description.toLowerCase().includes(queryLower)) ||
      (event.location && event.location.toLowerCase().includes(queryLower))
    )
  })


  const userData = await kv.hgetall(`user:${userId}`)
  const hasGoogleCalendar = userData?.provider === "google" && userData?.accessToken && userData?.refreshToken

  if (hasGoogleCalendar) {
    try {


      const start = new Date(0)
      const end = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365)

      const googleEvents = await getGoogleCalendarEvents(
        userId,
        userData.accessToken as string,
        userData.refreshToken as string,
        userData.expiresAt as number,
        start,
        end,
      )

      const matchingGoogleEvents = googleEvents.filter((event) => {
        return (
          event.title.toLowerCase().includes(queryLower) ||
          (event.description && event.description.toLowerCase().includes(queryLower)) ||
          (event.location && event.location.toLowerCase().includes(queryLower))
        )
      })


      const allMatchingEvents = [...matchingEvents, ...matchingGoogleEvents]
      const uniqueEvents = allMatchingEvents.filter(
        (event, index, self) => index === self.findIndex((e) => e.id === event.id),
      )

      return uniqueEvents.map((event) => adjustEventTimezone(event as CalendarEvent, timezone))
    } catch (error) {
      console.error("Error searching Google Calendar:", error)

    }
  }

  return matchingEvents.map((event) => adjustEventTimezone(event as CalendarEvent, timezone))
}


export async function exportToICS(userId: string, start?: Date, end?: Date): Promise<string> {

  const userTimezone = await getUserTimezone(userId)


  const events = await getEvents(userId, start || new Date(0), end || new Date(Date.now() + 1000 * 60 * 60 * 24 * 365))


  const calendar = ical({
    name: "Zero Calendar",
    timezone: userTimezone,
  })


  events.forEach((event) => {

    if (event.isRecurringInstance) return

    const icalEvent = calendar.createEvent({
      id: event.id,
      start: new Date(event.start),
      end: new Date(event.end),
      summary: event.title,
      description: event.description,
      location: event.location,
      timezone: event.timezone || userTimezone,
      allDay: event.allDay,
    })


    if (event.recurrence) {
      const rruleOptions = recurrenceRuleToRRuleOptions(event.recurrence, new Date(event.start))
      const rule = new RRule(rruleOptions)
      icalEvent.repeating(rule.toString())


      if (event.exceptions) {
        event.exceptions.forEach((exception) => {
          if (exception.status === "cancelled") {
            icalEvent.exdate(new Date(exception.date))
          } else if (exception.status === "modified" && exception.modifiedEvent) {

            calendar.createEvent({
              id: `${event.id}_exception_${new Date(exception.date).toISOString()}`,
              start: new Date(exception.modifiedEvent.start || event.start),
              end: new Date(exception.modifiedEvent.end || event.end),
              summary: exception.modifiedEvent.title || event.title,
              description: exception.modifiedEvent.description || event.description,
              location: exception.modifiedEvent.location || event.location,
              timezone: event.timezone || userTimezone,
              allDay: exception.modifiedEvent.allDay || event.allDay,
              recurrenceId: new Date(exception.date),
            })
          }
        })
      }
    }


    if (event.attendees) {
      event.attendees.forEach((attendee) => {
        icalEvent.createAttendee({
          email: attendee.email,
          name: attendee.name,
          status: attendee.status as any,
        })
      })
    }


    if (event.categories) {
      icalEvent.categories(event.categories)
    }
  })

  return calendar.toString()
}


export async function importFromICS(userId: string, icsData: string): Promise<{ imported: number; errors: number }> {
  const userTimezone = await getUserTimezone(userId)
  let imported = 0
  let errors = 0

  try {

    const parseICS = (icsData) => {

      const events = {}
      const lines = icsData.split("\n")
      let currentEvent = null

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()

        if (line === "BEGIN:VEVENT") {
          currentEvent = { type: "VEVENT" }
        } else if (line === "END:VEVENT" && currentEvent) {
          const uid = currentEvent.uid || `event_${Object.keys(events).length}`
          events[uid] = currentEvent
          currentEvent = null
        } else if (currentEvent) {
          const [key, value] = line.split(":")
          if (key && value) {
            if (key === "DTSTART") {
              currentEvent.start = new Date(value)
            } else if (key === "DTEND") {
              currentEvent.end = new Date(value)
            } else if (key === "SUMMARY") {
              currentEvent.summary = value
            } else if (key === "DESCRIPTION") {
              currentEvent.description = value
            } else if (key === "LOCATION") {
              currentEvent.location = value
            } else if (key === "UID") {
              currentEvent.uid = value
            }
          }
        }
      }

      return events
    }


    const parsedEvents = parseICS(icsData)


    for (const key in parsedEvents) {
      const parsedEvent = parsedEvents[key]


      if (parsedEvent.type !== "VEVENT") continue

      try {

        const event: CalendarEvent = {
          id: `imported_${uuidv4()}`,
          title: parsedEvent.summary || "Untitled Event",
          description: parsedEvent.description,
          start: parsedEvent.start.toISOString(),
          end: parsedEvent.end.toISOString(),
          location: parsedEvent.location,
          userId,
          source: "local",
          timezone: parsedEvent.timezone || userTimezone,
          allDay: parsedEvent.allDay || false,
        }


        if (parsedEvent.rrule) {
          const rrule = parsedEvent.rrule.toString()


          let frequency: "daily" | "weekly" | "monthly" | "yearly" = "daily"
          if (rrule.includes("FREQ=DAILY")) frequency = "daily"
          if (rrule.includes("FREQ=WEEKLY")) frequency = "weekly"
          if (rrule.includes("FREQ=MONTHLY")) frequency = "monthly"
          if (rrule.includes("FREQ=YEARLY")) frequency = "yearly"


          const intervalMatch = rrule.match(/INTERVAL=(\d+)/)
          const interval = intervalMatch ? Number.parseInt(intervalMatch[1]) : 1


          const countMatch = rrule.match(/COUNT=(\d+)/)
          const count = countMatch ? Number.parseInt(countMatch[1]) : undefined


          const untilMatch = rrule.match(/UNTIL=(\d+T\d+Z)/)
          const until = untilMatch ? new Date(untilMatch[1]).toISOString() : undefined


          const byDayMatch = rrule.match(/BYDAY=([^;]+)/)
          const byDay = byDayMatch ? byDayMatch[1].split(",") : undefined


          const byMonthDayMatch = rrule.match(/BYMONTHDAY=([^;]+)/)
          const byMonthDay = byMonthDayMatch ? byMonthDayMatch[1].split(",").map(Number) : undefined


          const byMonthMatch = rrule.match(/BYMONTH=([^;]+)/)
          const byMonth = byMonthMatch ? byMonthMatch[1].split(",").map(Number) : undefined


          event.recurrence = {
            frequency,
            interval,
            count,
            until,
            byDay,
            byMonthDay,
            byMonth,
          }


          if (parsedEvent.exdate) {
            event.exceptions = []


            const exdates = Array.isArray(parsedEvent.exdate) ? parsedEvent.exdate : [parsedEvent.exdate]

            exdates.forEach((exdate) => {
              event.exceptions!.push({
                date: exdate.toISOString(),
                status: "cancelled",
              })
            })
          }
        }


        await createEvent(event)
        imported++
      } catch (error) {
        console.error("Error importing event:", error)
        errors++
      }
    }

    return { imported, errors }
  } catch (error) {
    console.error("Error parsing ICS data:", error)
    return { imported, errors: 1 }
  }
}


export async function exportToCSV(userId: string, start?: Date, end?: Date): Promise<string> {

  const userTimezone = await getUserTimezone(userId)


  const events = await getEvents(userId, start || new Date(0), end || new Date(Date.now() + 1000 * 60 * 60 * 24 * 365))


  let csv = "Subject,Start Date,Start Time,End Date,End Time,All Day,Description,Location,Categories\n"


  events.forEach((event) => {
    const startDate = new Date(event.start)
    const endDate = new Date(event.end)


    const startDateFormatted = format(startDate, "MM/dd/yyyy")
    const startTimeFormatted = event.allDay ? "" : format(startDate, "HH:mm")
    const endDateFormatted = format(endDate, "MM/dd/yyyy")
    const endTimeFormatted = event.allDay ? "" : format(endDate, "HH:mm")


    const escapeCSV = (field = "") => `"${field.replace(/"/g, '""')}"`


    csv +=
      [
        escapeCSV(event.title),
        startDateFormatted,
        startTimeFormatted,
        endDateFormatted,
        endTimeFormatted,
        event.allDay ? "TRUE" : "FALSE",
        escapeCSV(event.description),
        escapeCSV(event.location),
        escapeCSV(event.categories?.join(", ")),
      ].join(",") + "\n"
  })

  return csv
}


export async function importFromCSV(userId: string, csvData: string): Promise<{ imported: number; errors: number }> {
  const userTimezone = await getUserTimezone(userId)
  let imported = 0
  let errors = 0

  try {

    const rows = csvData.split("\n")
    const headers = rows[0].split(",")


    const getColumnIndex = (name: string) => {
      const index = headers.findIndex((h) => h.toLowerCase().includes(name.toLowerCase()))
      return index >= 0 ? index : null
    }

    const subjectIndex = getColumnIndex("subject") || getColumnIndex("title")
    const startDateIndex = getColumnIndex("start date")
    const startTimeIndex = getColumnIndex("start time")
    const endDateIndex = getColumnIndex("end date")
    const endTimeIndex = getColumnIndex("end time")
    const allDayIndex = getColumnIndex("all day")
    const descriptionIndex = getColumnIndex("description")
    const locationIndex = getColumnIndex("location")
    const categoriesIndex = getColumnIndex("categories")


    if (subjectIndex === null || startDateIndex === null) {
      throw new Error("CSV must contain at least Subject/Title and Start Date columns")
    }


    for (let i = 1; i < rows.length; i++) {
      if (!rows[i].trim()) continue

      try {

        const row = rows[i].split(",")


        const parseField = (index: number | null) => {
          if (index === null || index >= row.length) return ""

          let value = row[index].trim()


          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.substring(1, value.length - 1).replace(/""/g, '"')
          }

          return value
        }


        const title = parseField(subjectIndex)
        const startDateStr = parseField(startDateIndex)
        const startTimeStr = startTimeIndex !== null ? parseField(startTimeIndex) : ""
        const endDateStr = endDateIndex !== null ? parseField(endDateIndex) : startDateStr
        const endTimeStr =
          endTimeIndex !== null
            ? parseField(endTimeIndex)
            : startTimeStr
              ? addMinutes(parseISO(`${startDateStr}T${startTimeStr}`), 30)
                  .toISOString()
                  .substring(11, 16)
              : ""
        const allDayStr = allDayIndex !== null ? parseField(allDayIndex).toLowerCase() : ""
        const description = descriptionIndex !== null ? parseField(descriptionIndex) : ""
        const location = locationIndex !== null ? parseField(locationIndex) : ""
        const categoriesStr = categoriesIndex !== null ? parseField(categoriesIndex) : ""


        const startDate = parseISO(`${startDateStr}${startTimeStr ? `T${startTimeStr}` : "T00:00:00"}`)
        const endDate = parseISO(`${endDateStr}${endTimeStr ? `T${endTimeStr}` : "T23:59:59"}`)


        const allDay = allDayStr === "true" || allDayStr === "yes" || allDayStr === "1" || !startTimeStr


        const categories = categoriesStr ? categoriesStr.split(",").map((c) => c.trim()) : []


        const event: CalendarEvent = {
          id: `imported_${uuidv4()}`,
          title,
          description,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          location,
          userId,
          source: "local",
          timezone: userTimezone,
          allDay,
          categories: categories.length > 0 ? categories : undefined,
        }


        await createEvent(event)
        imported++
      } catch (error) {
        console.error("Error importing event from CSV row:", error)
        errors++
      }
    }

    return { imported, errors }
  } catch (error) {
    console.error("Error parsing CSV data:", error)
    return { imported, errors: 1 }
  }
}

export async function getUserCategories(userId: string): Promise<CalendarCategory[]> {
  try {

    const categories = await kv.lrange<CalendarCategory>(`user:${userId}:categories`, 0, -1)


    if (!categories || categories.length === 0) {
      return [
        { id: "personal", name: "Personal", color: "#3b82f6", userId, visible: true },
        { id: "work", name: "Work", color: "#10b981", userId, visible: true },
        { id: "family", name: "Family", color: "#8b5cf6", userId, visible: true },
      ]
    }

    return categories
  } catch (error) {
    console.error("Error fetching categories:", error)
    throw new Error("Failed to fetch categories")
  }
}


export async function getSharedEvents(userId: string, start?: Date, end?: Date): Promise<CalendarEvent[]> {
  try {

    const sharedEvents = (await kv.zrange(`shared_events:${userId}`, 0, -1)) as CalendarEvent[]


    if (!start || !end) {
      return sharedEvents || []
    }


    const startTimestamp = start.getTime()
    const endTimestamp = end.getTime()

    return sharedEvents.filter((event) => {

      if (!event || !event.start || !event.end) {
        return false
      }

      try {
        const eventStart = new Date(event.start).getTime()
        const eventEnd = new Date(event.end).getTime()

        return (
          (eventStart >= startTimestamp && eventStart <= endTimestamp) ||
          (eventEnd >= startTimestamp && eventEnd <= endTimestamp) ||
          (eventStart <= startTimestamp && eventEnd >= endTimestamp)
        )
      } catch (error) {
        console.error("Error filtering shared event:", error)
        return false
      }
    })
  } catch (error) {
    console.error("Error getting shared events:", error)
    return []
  }
}


export async function syncWithGoogleCalendar(userId: string): Promise<{ success: boolean; message: string }> {
  try {

    const userData = await kv.hgetall(`user:${userId}`)

    if (!userData?.provider || userData.provider !== "google" || !userData.accessToken || !userData.refreshToken) {
      return {
        success: false,
        message: "Google Calendar is not connected. Please connect your Google account first.",
      }
    }


    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const end = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)


    const googleEvents = await getGoogleCalendarEvents(
      userId,
      userData.accessToken as string,
      userData.refreshToken as string,
      userData.expiresAt as number,
      start,
      end,
    )


    const localEvents = await kv.lrange<CalendarEvent>(`user:${userId}:events`, 0, -1)


    const nonGoogleEvents = localEvents.filter((event) => event.source !== "google")


    let created = 0
    for (const event of nonGoogleEvents) {
      try {
        await createGoogleCalendarEvent(
          userId,
          userData.accessToken as string,
          userData.refreshToken as string,
          userData.expiresAt as number,
          event,
        )
        created++
      } catch (error) {
        console.error("Error creating event in Google Calendar:", error)
      }
    }


    await kv.hset(`user:${userId}`, { lastGoogleSync: Date.now() })

    return {
      success: true,
      message: `Sync completed successfully. ${created} local events were added to Google Calendar.`,
    }
  } catch (error) {
    console.error("Error syncing with Google Calendar:", error)
    return {
      success: false,
      message: "An error occurred while syncing with Google Calendar. Please try again later.",
    }
  }
}


export async function hasGoogleCalendarConnected(userId: string): Promise<boolean> {
  const userData = await kv.hgetall(`user:${userId}`)
  return !!(userData?.provider === "google" && userData?.accessToken && userData?.refreshToken)
}

export async function createCalendar(calendar: {
  userId: string
  name: string
  color: string
}): Promise<CalendarCategory> {
  try {
    const newCalendar: CalendarCategory = {
      ...calendar,
      id: nanoid(),
      visible: true,
    }


    await kv.rpush(`user:${calendar.userId}:categories`, newCalendar)
    return newCalendar
  } catch (error) {
    console.error("Error creating calendar:", error)
    throw new Error("Failed to create calendar")
  }
}

export async function toggleCalendarVisibility(userId: string, calendarId: string): Promise<void> {
  try {


    const calendars = await kv.lrange<CalendarCategory>(`user:${userId}:categories`, 0, -1)


    if (!calendars || calendars.length === 0) {
      const defaultCalendars = [
        { id: "personal", name: "Personal", color: "#3b82f6", userId, visible: true },
        { id: "work", name: "Work", color: "#10b981", userId, visible: true },
        { id: "family", name: "Family", color: "#8b5cf6", userId, visible: true },
      ]


      const calendarIndex = defaultCalendars.findIndex((cal) => cal.id === calendarId)

      if (calendarIndex === -1) {
        throw new Error(`Calendar with ID ${calendarId} not found`)
      }


      defaultCalendars[calendarIndex].visible = !defaultCalendars[calendarIndex].visible


      await kv.del(`user:${userId}:categories`)
      await kv.rpush(`user:${userId}:categories`, ...defaultCalendars)

      return
    }


    const calendarIndex = calendars.findIndex((cal) => cal.id === calendarId)

    if (calendarIndex === -1) {
      throw new Error(`Calendar with ID ${calendarId} not found`)
    }


    const updatedCalendars = [...calendars]
    updatedCalendars[calendarIndex] = {
      ...updatedCalendars[calendarIndex],
      visible: !updatedCalendars[calendarIndex].visible,
    }


    await kv.del(`user:${userId}:categories`)
    if (updatedCalendars.length > 0) {
      await kv.rpush(`user:${userId}:categories`, ...updatedCalendars)
    }


    const visibilitySettings = (await kv.hgetall(`user:${userId}:visibility`)) || {}
    await kv.hset(`user:${userId}:visibility`, {
      ...visibilitySettings,
      [calendarId]: !updatedCalendars[calendarIndex].visible,
    })
  } catch (error) {
    console.error("Error toggling calendar visibility:", error)
    throw new Error("Failed to toggle calendar visibility")
  }
}

export async function getEvent(userId: string, eventId: string): Promise<CalendarEvent | null> {
  try {

    const events = await kv.lrange<CalendarEvent>(`user:${userId}:events`, 0, -1)
    return events.find((event) => event.id === eventId) || null
  } catch (error) {
    console.error("Error fetching event:", error)
    return null
  }
}


function formatDateTimeForInput(dateStr: string, timezone?: string, allDay?: boolean): string {
  try {
    const date = parseISO(dateStr)

    if (allDay) {
      return format(date, "yyyy-MM-dd")
    }


    return format(date, "yyyy-MM-dd'T'HH:mm")
  } catch (error) {
    console.error("Error formatting date:", error)
    return dateStr
  }
}


export async function getTodayEvents(userId: string): Promise<CalendarEvent[]> {
  try {
    const today = new Date()
    const startOfToday = new Date(today)
    startOfToday.setHours(0, 0, 0, 0)

    const endOfToday = new Date(today)
    endOfToday.setHours(23, 59, 59, 999)

    return await getEvents(userId, startOfToday, endOfToday)
  } catch (error) {
    console.error("Error fetching today's events:", error)
    return []
  }
}
