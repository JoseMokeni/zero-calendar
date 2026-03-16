import { groq } from "@ai-sdk/groq"
import { generateText } from "ai"
import { auth } from "@/lib/auth"
import { calendarTools } from "@/lib/ai-tools"
import { createEvent, updateEvent, deleteEvent, getEvents } from "@/lib/calendar"
import { getSystemPrompt } from "@/lib/system-prompts"
import { findEventByIdentifier as findEvent, extractTimeFromMessage } from "@/lib/ai-calendar-intent"

export const runtime = "nodejs"


const conversationContexts = new Map<string, string>()

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session?.user) {
      return new Response("Unauthorized", { status: 401 })
    }

    const { message, history, conversationId } = await req.json()
    console.log(`[AI Chat] Processing message for conversation: ${conversationId}`)
    console.log(`[AI Chat] Message: "${message.substring(0, 50)}..."`)


    let conversationContext = ""
    if (conversationId) {
      conversationContext = conversationContexts.get(conversationId) || ""


      if (!conversationContext && history) {
        conversationContext = history
      }


      if (conversationContext) {
        conversationContext += `\n\nUser: ${message}`
      } else {
        conversationContext = `User: ${message}`
      }


      conversationContexts.set(conversationId, conversationContext)
    } else {

      conversationContext = `User: ${message}`
    }

    console.log(`[AI Chat] Context length: ${conversationContext.length} characters`)


    const systemPrompt = getSystemPrompt("calendar")

    try {

      const isEventQuery = checkForEventQuery(message)
      if (isEventQuery) {
        console.log(`[AI Chat] Detected direct event query: "${message}"`)

        try {

          const searchTerms = extractSearchTerms(message)
          console.log(`[AI Chat] Extracted search terms: ${searchTerms || "none"}`)


          const today = new Date()
          const nextMonth = new Date(today)
          nextMonth.setMonth(today.getMonth() + 1)


          const events = await getEvents(session.user.id, today, nextMonth)
          console.log(`[AI Chat] Found ${events.length} total events`)


          let matchingEvents = events
          if (searchTerms) {
            const terms = searchTerms.toLowerCase().split(/\s+/)
            matchingEvents = events.filter((event) => {
              const title = event.title.toLowerCase()
              const description = (event.description || "").toLowerCase()
              const location = (event.location || "").toLowerCase()


              return terms.some((term) => title.includes(term) || description.includes(term) || location.includes(term))
            })
          }

          console.log(`[AI Chat] Found ${matchingEvents.length} matching events`)


          let eventsInfo = ""
          if (matchingEvents.length === 0) {
            eventsInfo = "I checked your calendar and found no events matching your query."
          } else {
            eventsInfo = "I found the following events in your calendar:\n\n"
            matchingEvents.forEach((event, index) => {
              const startDate = new Date(event.start)
              const endDate = new Date(event.end)
              eventsInfo += `${index + 1}. "${event.title}" on ${startDate.toLocaleDateString()} at ${startDate.toLocaleTimeString()} to ${endDate.toLocaleTimeString()}`
              if (event.location) eventsInfo += ` at ${event.location}`
              eventsInfo += "\n"
            })
          }


          const queryResponsePrompt = `${conversationContext}\n\n${eventsInfo}\n\nPlease respond to the user's query about their calendar based on the information above. Be conversational and helpful. Don't mention that you're using any tools or APIs.`

          const queryResponse = await generateText({
            model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
            prompt: queryResponsePrompt,
            system: systemPrompt,
            temperature: 0.6,
            maxTokens: 1000,
          })


          const assistantResponse = queryResponse.text
          conversationContexts.set(conversationId, conversationContext + `\n\nAssistant: ${assistantResponse}`)

          return Response.json({
            response: assistantResponse,
            usedTools: true,
          })
        } catch (queryError) {
          console.error("[AI Chat] Error handling direct event query:", queryError)

        }
      }


      const intentAnalysis = await determineCalendarIntent(message)
      console.log(`[AI Chat] Intent analysis:`, intentAnalysis)


      if (intentAnalysis.intent === "create_event") {

        console.log(`[AI Chat] Creating event with details:`, intentAnalysis.eventDetails)

        try {

          const extractedTime = extractTimeFromMessage(message)
          let startTime = new Date(intentAnalysis.eventDetails.startTime)
          let endTime = new Date(intentAnalysis.eventDetails.endTime)


          if (extractedTime) {
            console.log(`[AI Chat] Extracted time from message: ${extractedTime.hour}:${extractedTime.minute}`)


            const newStartTime = new Date(startTime)
            newStartTime.setHours(extractedTime.hour)
            newStartTime.setMinutes(extractedTime.minute)

            const newEndTime = new Date(newStartTime)
            newEndTime.setHours(newEndTime.getHours() + 1)

            startTime = newStartTime
            endTime = newEndTime

            console.log(`[AI Chat] Adjusted start time: ${startTime.toISOString()}`)
            console.log(`[AI Chat] Adjusted end time: ${endTime.toISOString()}`)
          }


          const newEvent = await createEvent({
            userId: session.user.id,
            title: intentAnalysis.eventDetails.title,
            start: startTime.toISOString(),
            end: endTime.toISOString(),
            description: intentAnalysis.eventDetails.description || "",
            location: intentAnalysis.eventDetails.location || "",
            color: intentAnalysis.eventDetails.color || "#3b82f6",
            allDay: intentAnalysis.eventDetails.allDay || false,
          })

          console.log(`[AI Chat] Event created successfully:`, newEvent.id)
          console.log(`[AI Chat] Created event start time:`, new Date(newEvent.start).toISOString())
          console.log(`[AI Chat] Created event end time:`, new Date(newEvent.end).toISOString())


          const eventStartTime = new Date(newEvent.start)
          const eventEndTime = new Date(newEvent.end)

          const eventInfo = `
I've created the following event:
- Title: ${newEvent.title}
- Date: ${eventStartTime.toLocaleDateString()}
- Time: ${eventStartTime.toLocaleTimeString()} to ${eventEndTime.toLocaleTimeString()}
${newEvent.location ? `- Location: ${newEvent.location}` : ""}
${newEvent.description ? `- Description: ${newEvent.description}` : ""}
`

          const confirmationPrompt = `${conversationContext}

${eventInfo}

Please confirm to the user that you've created this event. Be conversational and friendly, but make it clear that the event has been successfully added to their calendar with the EXACT time they requested. Don't mention that you're using any tools or APIs.`

          const confirmationResponse = await generateText({
            model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
            prompt: confirmationPrompt,
            system: systemPrompt,
            temperature: 0.6,
            maxTokens: 1000,
          })


          const assistantResponse = confirmationResponse.text
          conversationContexts.set(conversationId, conversationContext + `\n\nAssistant: ${assistantResponse}`)

          return Response.json({
            response: assistantResponse,
            usedTools: true,
            eventCreated: true,
            eventDetails: {
              id: newEvent.id,
              title: newEvent.title,
              start: newEvent.start,
              end: newEvent.end,
            },
          })
        } catch (createError) {
          console.error("[AI Chat] Error creating event:", createError)


          const errorPrompt = `${conversationContext}

I tried to create an event but encountered an error: ${createError.message}. Please provide an apologetic response to the user explaining that the event couldn't be created.`

          const errorResponse = await generateText({
            model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
            prompt: errorPrompt,
            system: systemPrompt,
            temperature: 0.6,
            maxTokens: 1000,
          })


          const assistantResponse = errorResponse.text
          conversationContexts.set(conversationId, conversationContext + `\n\nAssistant: ${assistantResponse}`)

          return Response.json({
            response: assistantResponse,
            usedTools: true,
            error: "Failed to create event: " + createError.message,
          })
        }
      } else if (intentAnalysis.intent === "query_events") {

        console.log(`[AI Chat] Querying events with parameters:`, intentAnalysis.queryParams)

        try {

          let queryResult

          if (intentAnalysis.queryParams.type === "today") {
            queryResult = await calendarTools.getTodayEvents(session.user.id)
          } else if (intentAnalysis.queryParams.type === "upcoming") {
            const today = new Date()
            const nextWeek = new Date(today)
            nextWeek.setDate(today.getDate() + 7)
            queryResult = await calendarTools.getEvents(session.user.id, today, nextWeek)
          } else if (intentAnalysis.queryParams.type === "search") {
            queryResult = await calendarTools.findEvents(session.user.id, intentAnalysis.queryParams.searchTerm)
          } else if (intentAnalysis.queryParams.type === "date") {
            const date = new Date(intentAnalysis.queryParams.date)
            const nextDay = new Date(date)
            nextDay.setDate(date.getDate() + 1)
            queryResult = await calendarTools.getEvents(session.user.id, date, nextDay)
          } else if (intentAnalysis.queryParams.type === "range") {
            const startDate = new Date(intentAnalysis.queryParams.startDate)
            const endDate = new Date(intentAnalysis.queryParams.endDate)
            queryResult = await calendarTools.getEvents(session.user.id, startDate, endDate)
          } else {

            queryResult = await calendarTools.getTodayEvents(session.user.id)
          }

          console.log(`[AI Chat] Query result:`, queryResult)


          let eventsInfo = ""
          const events = queryResult.events || []

          if (events.length === 0) {
            eventsInfo = "I checked your calendar and found no events matching your query."
          } else {
            eventsInfo = "I found the following events in your calendar:\n\n"
            events.forEach((event, index) => {
              const startDate = new Date(event.start)
              const endDate = new Date(event.end)
              eventsInfo += `${index + 1}. "${event.title}" on ${startDate.toLocaleDateString()} at ${startDate.toLocaleTimeString()} to ${endDate.toLocaleTimeString()}`
              if (event.location) eventsInfo += ` at ${event.location}`
              eventsInfo += "\n"
            })
          }


          const queryResponsePrompt = `${conversationContext}

${eventsInfo}

Please respond to the user's query about their calendar based on the information above. Be conversational and helpful. Don't mention that you're using any tools or APIs.`

          const queryResponse = await generateText({
            model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
            prompt: queryResponsePrompt,
            system: systemPrompt,
            temperature: 0.6,
            maxTokens: 1000,
          })


          const assistantResponse = queryResponse.text
          conversationContexts.set(conversationId, conversationContext + `\n\nAssistant: ${assistantResponse}`)

          return Response.json({
            response: assistantResponse,
            usedTools: true,
          })
        } catch (queryError) {
          console.error("[AI Chat] Error querying events:", queryError)


          const errorResponse = await generateText({
            model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
            prompt: `${conversationContext}

I tried to check your calendar but encountered an error. Please provide an apologetic response to the user.`,
            system: systemPrompt,
            temperature: 0.6,
            maxTokens: 1000,
          })


          const assistantResponse = errorResponse.text
          conversationContexts.set(conversationId, conversationContext + `\n\nAssistant: ${assistantResponse}`)

          return Response.json({
            response: assistantResponse,
            usedTools: true,
            error: "Failed to query events: " + queryError.message,
          })
        }
      } else if (intentAnalysis.intent === "update_event") {

        console.log(`[AI Chat] Updating event with identifier:`, intentAnalysis.eventIdentifier)
        console.log(`[AI Chat] Updates:`, intentAnalysis.updates)

        try {

          const eventToUpdate = await findEvent(session.user.id, intentAnalysis.eventIdentifier)

          if (eventToUpdate) {
            console.log(`[AI Chat] Found event to update:`, eventToUpdate.id)


            if (intentAnalysis.updates.startTime) {
              const extractedTime = extractTimeFromMessage(message)
              if (extractedTime) {
                console.log(`[AI Chat] Extracted time from message: ${extractedTime.hour}:${extractedTime.minute}`)


                const newStartTime = new Date(intentAnalysis.updates.startTime)
                newStartTime.setHours(extractedTime.hour)
                newStartTime.setMinutes(extractedTime.minute)

                intentAnalysis.updates.startTime = newStartTime.toISOString()


                if (intentAnalysis.updates.endTime) {
                  const newEndTime = new Date(newStartTime)
                  newEndTime.setHours(newEndTime.getHours() + 1)
                  intentAnalysis.updates.endTime = newEndTime.toISOString()
                }

                console.log(`[AI Chat] Adjusted start time: ${intentAnalysis.updates.startTime}`)
                if (intentAnalysis.updates.endTime) {
                  console.log(`[AI Chat] Adjusted end time: ${intentAnalysis.updates.endTime}`)
                }
              }
            }


            const updatedEvent = await updateEvent({
              ...eventToUpdate,
              ...intentAnalysis.updates,
            })

            console.log(`[AI Chat] Event updated successfully:`, updatedEvent.id)


            const updateInfo = `
I've updated the event "${updatedEvent.title}" with the following changes:
${intentAnalysis.updates.title ? `- New title: ${updatedEvent.title}` : ""}
${intentAnalysis.updates.startTime ? `- New start time: ${new Date(updatedEvent.start).toLocaleString()}` : ""}
${intentAnalysis.updates.endTime ? `- New end time: ${new Date(updatedEvent.end).toLocaleString()}` : ""}
${intentAnalysis.updates.location ? `- New location: ${updatedEvent.location}` : ""}
${intentAnalysis.updates.description ? `- Updated description` : ""}
`

            const confirmationPrompt = `${conversationContext}

${updateInfo}

Please confirm to the user that you've updated this event. Be conversational and friendly, but make it clear that the event has been successfully updated in their calendar with the EXACT time they requested. Don't mention that you're using any tools or APIs.`

            const confirmationResponse = await generateText({
              model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
              prompt: confirmationPrompt,
              system: systemPrompt,
              temperature: 0.6,
              maxTokens: 1000,
            })


            const assistantResponse = confirmationResponse.text
            conversationContexts.set(conversationId, conversationContext + `\n\nAssistant: ${assistantResponse}`)

            return Response.json({
              response: assistantResponse,
              usedTools: true,
              eventUpdated: true,
              eventDetails: {
                id: updatedEvent.id,
                title: updatedEvent.title,
                updates: Object.keys(intentAnalysis.updates),
              },
            })
          } else {

            console.log(`[AI Chat] No event found matching identifier:`, intentAnalysis.eventIdentifier)

            const noEventPrompt = `${conversationContext}

I couldn't find an event matching "${intentAnalysis.eventIdentifier}" in your calendar. Please ask the user for more details about which event they want to update.`

            const noEventResponse = await generateText({
              model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
              prompt: noEventPrompt,
              system: systemPrompt,
              temperature: 0.6,
              maxTokens: 1000,
            })


            const assistantResponse = noEventResponse.text
            conversationContexts.set(conversationId, conversationContext + `\n\nAssistant: ${assistantResponse}`)

            return Response.json({
              response: assistantResponse,
              usedTools: true,
              error: "No matching event found",
            })
          }
        } catch (updateError) {
          console.error("[AI Chat] Error updating event:", updateError)


          const errorResponse = await generateText({
            model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
            prompt: `${conversationContext}

I tried to update the event but encountered an error: ${updateError.message}. Please provide an apologetic response to the user.`,
            system: systemPrompt,
            temperature: 0.6,
            maxTokens: 1000,
          })


          const assistantResponse = errorResponse.text
          conversationContexts.set(conversationId, conversationContext + `\n\nAssistant: ${assistantResponse}`)

          return Response.json({
            response: assistantResponse,
            usedTools: true,
            error: "Failed to update event: " + updateError.message,
          })
        }
      } else if (intentAnalysis.intent === "delete_event") {

        console.log(`[AI Chat] Deleting event with identifier:`, intentAnalysis.eventIdentifier)

        try {

          const eventToDelete = await findEvent(session.user.id, intentAnalysis.eventIdentifier)

          if (eventToDelete) {
            console.log(`[AI Chat] Found event to delete:`, eventToDelete.id)


            await deleteEvent(session.user.id, eventToDelete.id)

            console.log(`[AI Chat] Event deleted successfully:`, eventToDelete.id)


            const deleteInfo = `
I've deleted the event "${eventToDelete.title}" that was scheduled for ${new Date(eventToDelete.start).toLocaleString()}.
`

            const confirmationPrompt = `${conversationContext}

${deleteInfo}

Please confirm to the user that you've deleted this event. Be conversational and friendly, but make it clear that the event has been successfully removed from their calendar. Don't mention that you're using any tools or APIs.`

            const confirmationResponse = await generateText({
              model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
              prompt: confirmationPrompt,
              system: systemPrompt,
              temperature: 0.6,
              maxTokens: 1000,
            })


            const assistantResponse = confirmationResponse.text
            conversationContexts.set(conversationId, conversationContext + `\n\nAssistant: ${assistantResponse}`)

            return Response.json({
              response: assistantResponse,
              usedTools: true,
              eventDeleted: true,
              eventDetails: {
                id: eventToDelete.id,
                title: eventToDelete.title,
              },
            })
          } else {

            console.log(`[AI Chat] No event found matching identifier:`, intentAnalysis.eventIdentifier)

            const noEventPrompt = `${conversationContext}

I couldn't find an event matching "${intentAnalysis.eventIdentifier}" in your calendar. Please ask the user for more details about which event they want to delete.`

            const noEventResponse = await generateText({
              model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
              prompt: noEventPrompt,
              system: systemPrompt,
              temperature: 0.6,
              maxTokens: 1000,
            })


            const assistantResponse = noEventResponse.text
            conversationContexts.set(conversationId, conversationContext + `\n\nAssistant: ${assistantResponse}`)

            return Response.json({
              response: assistantResponse,
              usedTools: true,
              error: "No matching event found",
            })
          }
        } catch (deleteError) {
          console.error("[AI Chat] Error deleting event:", deleteError)


          const errorResponse = await generateText({
            model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
            prompt: `${conversationContext}

I tried to delete the event but encountered an error: ${deleteError.message}. Please provide an apologetic response to the user.`,
            system: systemPrompt,
            temperature: 0.6,
            maxTokens: 1000,
          })


          const assistantResponse = errorResponse.text
          conversationContexts.set(conversationId, conversationContext + `\n\nAssistant: ${assistantResponse}`)

          return Response.json({
            response: assistantResponse,
            usedTools: true,
            error: "Failed to delete event: " + deleteError.message,
          })
        }
      } else {

        console.log(`[AI Chat] Handling general conversation or other intent`)


        const generalResponse = await generateText({
          model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
          prompt: conversationContext,
          system: systemPrompt,
          temperature: 0.6,
          maxTokens: 1000,
        })


        const assistantResponse = generalResponse.text
        conversationContexts.set(conversationId, conversationContext + `\n\nAssistant: ${assistantResponse}`)

        return Response.json({
          response: assistantResponse,
          usedTools: false,
        })
      }
    } catch (aiError) {
      console.error("[AI Chat] AI generation error:", aiError)


      try {
        console.log("[AI Chat] Attempting fallback without tools...")
        const fallbackResponse = await generateText({
          model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
          prompt: conversationContext,
          system: systemPrompt,
          temperature: 0.6,
          maxTokens: 1000,
        })


        const assistantResponse = fallbackResponse.text
        conversationContexts.set(conversationId, conversationContext + `\n\nAssistant: ${assistantResponse}`)

        return Response.json({
          response: assistantResponse,
          usedTools: false,
        })
      } catch (fallbackError) {
        console.error("[AI Chat] Fallback error:", fallbackError)


        let errorMessage = "I'm having trouble processing your request right now."

        if (aiError instanceof Error) {
          console.error("[AI Chat] Error details:", aiError.message)

          if (aiError.message.includes("token")) {
            errorMessage = "Your message is too long for me to process. Could you try a shorter question?"


            if (conversationId && conversationContexts.has(conversationId)) {
              const currentContext = conversationContexts.get(conversationId) || ""
              if (currentContext.length > 4000) {

                const trimmedContext = currentContext.split("\n\n").slice(-10).join("\n\n")
                conversationContexts.set(conversationId, trimmedContext)
                console.log("[AI Chat] Trimmed conversation context due to token limit")
              }
            }
          } else if (aiError.message.includes("rate") || aiError.message.includes("limit")) {
            errorMessage = "I'm receiving too many requests right now. Please try again in a moment."
          } else if (aiError.message.includes("key") || aiError.message.includes("auth")) {
            errorMessage = "There's an issue with my connection to the AI service. Please try again later."
          }
        }

        return Response.json({
          response: errorMessage,
          error: "AI generation failed: " + (aiError instanceof Error ? aiError.message : "Unknown error"),
        })
      }
    }
  } catch (error) {
    console.error("[AI Chat] Error processing request:", error)
    return Response.json(
      {
        error: "Failed to process your request: " + (error instanceof Error ? error.message : "Unknown error"),
        response: "Sorry, I encountered an error while processing your request. Please try again.",
      },
      { status: 500 },
    )
  }
}


function checkForEventQuery(message: string): boolean {
  const lowerMessage = message.toLowerCase()


  const eventQueryPatterns = [
    /when (is|do I have|are) .+/i,
    /what time (is|do I have) .+/i,
    /(do I have|is there) (a|an|any) .+ (meeting|appointment|event|call)/i,
    /where is (my|the) .+ (meeting|appointment|event|call)/i,
    /tell me about (my|the) .+ (meeting|appointment|event|call)/i,
    /(meeting|appointment|event|call) with .+/i,
    /when .+ (meeting|appointment|event|call)/i,
  ]

  return eventQueryPatterns.some((pattern) => pattern.test(lowerMessage))
}


function extractSearchTerms(message: string): string | null {
  const lowerMessage = message.toLowerCase()


  const withMatch = lowerMessage.match(/(?:meeting|appointment|event|call)?\s+(?:with|for)\s+([a-z0-9\s]+)/i)
  if (withMatch && withMatch[1]) {
    return withMatch[1].trim()
  }


  const eventMatch = lowerMessage.match(
    /(?:the|my|about|regarding)\s+([a-z0-9\s]+)(?:\s+meeting|\s+appointment|\s+event|\s+call)/i,
  )
  if (eventMatch && eventMatch[1]) {
    return eventMatch[1].trim()
  }


  const nameMatch = lowerMessage.match(
    /\b(alex|john|mary|sarah|michael|david|lisa|emma|james|robert|william|joseph|charles|thomas|daniel|matthew|andrew|christopher|joshua|timothy|george|kenneth|paul|mark|donald|steven|edward|brian|ronald|anthony|kevin|jason|jeff|gary|timothy|jose|larry|jeffrey|frank|scott|eric|stephen|jacob|raymond|patrick|sean|adam|jerry|dennis|tyler|samuel|gregory|henry|douglas|peter|joe|arthur|jack|dennis|walter|aaron|jose|albert|kyle|louis|russell|philip|howard|eugene|bobby|carlos|johnny|gerald|wayne|harry|ralph|roy|ryan|joe|justin|willie|jordan|jeremy|alan|billy|bruce|bryan|carl|vincent|terry|keith|lawrence|harold|roger|noah|christian|austin|tony|leonard|randy|craig|jonathan|micheal|todd|earl|jesse|benjamin|curtis|travis|bradley|dylan|herbert|lance|fredrick|joel|norman|leroy|marvin|glen|leslie|elliot|melvin|cecil|wade|edwin|milton|kurt|clifford|jay|willard|darrell|ross|brent|shane|marion|tracy|seth|kent|terrance|sergio|gilbert|dean|jorge|dan|derrick|brett|angelo|tony|marco|kirk|lloyd|nathan|orlando|rafael|alberto|omar|clifton|willard|daryl|ross|marshall|salvador|perry|kirk|lloyd|seth|kent|terrance|sergio|gilbert|dean|jorge|dan|derrick|brett|angelo|tony|marco|kirk|lloyd|nathan|orlando|rafael|alberto|omar|clifton|willard|daryl|ross|marshall|salvador|perry|kirk|lloyd)\b/i,
  )
  if (nameMatch && nameMatch[1]) {
    return nameMatch[1].trim()
  }


  return null
}


async function determineCalendarIntent(message: string): Promise<{
  intent: "create_event" | "query_events" | "update_event" | "delete_event" | "other"
  eventDetails?: {
    title: string
    startTime: string
    endTime: string
    description?: string
    location?: string
    color?: string
    allDay?: boolean
  }
  queryParams?: {
    type: "today" | "upcoming" | "search" | "date" | "range"
    searchTerm?: string
    date?: string
    startDate?: string
    endDate?: string
  }
  eventIdentifier?: string
  updates?: any
}> {
  try {

    const systemPrompt = `
You are a calendar assistant that analyzes user messages to determine their intent related to calendar operations.
Your task is to determine the user's intent and extract structured data from their message.
You must output a valid JSON object with your determination.

The possible intents are:
1. create_event - User wants to create a new calendar event
2. query_events - User is asking about events or their schedule
3. update_event - User wants to update an existing event
4. delete_event - User wants to delete an event
5. other - Any other intent that doesn't fit the above

Output format for create_event:
{
  "intent": "create_event",
  "eventDetails": {
    "title": "string",
    "startTime": "ISO string",
    "endTime": "ISO string",
    "description": "string",
    "location": "string",
    "allDay": boolean
  }
}

Output format for query_events:
{
  "intent": "query_events",
  "queryParams": {
    "type": "today" | "upcoming" | "search" | "date" | "range",
    "searchTerm": "string",
    "date": "ISO string",
    "startDate": "ISO string",
    "endDate": "ISO string"
  }
}

Output format for update_event:
{
  "intent": "update_event",
  "eventIdentifier": "string",
  "updates": {

    "title": "string",
    "startTime": "ISO string",
    "endTime": "ISO string",
    "description": "string",
    "location": "string",
    "allDay": boolean
  }
}

Output format for delete_event:
{
  "intent": "delete_event",
  "eventIdentifier": "string"
}

Output format for other:
{
  "intent": "other"
}

IMPORTANT GUIDELINES:
- Always return a valid JSON object
- Use ISO format for dates and times
- For dates without specific times mentioned, use appropriate defaults (9:00 AM for morning, 12:00 PM for afternoon, etc.)
- For events without a specified duration, default to 1 hour
- If a specific time is mentioned (like "11:00 AM"), do NOT make it an all-day event
- If no specific time is mentioned and it seems like an all-day event, set allDay to true
- Extract as much detail as possible from the message
- If the intent is unclear, default to "other"
- Do not include any explanations or text outside the JSON object
- Current date and time: ${new Date().toISOString()}
- CRITICAL: When handling times, always preserve the exact time mentioned by the user. If they say "12pm" or "noon", the time must be 12:00, not converted to another time zone or format.
`


    const response = await generateText({
      model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
      prompt: message,
      system: systemPrompt,
      temperature: 0.2,
      maxTokens: 1000,
    })


    const jsonMatch = response.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error("Failed to extract JSON from AI intent determination")
      return { intent: "other" }
    }

    try {

      const intentData = JSON.parse(jsonMatch[0])


      if (!intentData.intent) {
        console.error("Missing intent in AI response")
        return { intent: "other" }
      }


      if (intentData.intent === "create_event") {
        if (!intentData.eventDetails) {
          console.error("Missing required fields for create_event intent")
          return { intent: "other" }
        }
        if (!intentData.eventDetails.title) {
          intentData.eventDetails.title = "New Event"
        }
      }

      if (intentData.intent === "update_event" && (!intentData.eventIdentifier || !intentData.updates)) {
        console.error("Missing required fields for update_event intent")
        return { intent: "other" }
      }

      if (intentData.intent === "delete_event" && !intentData.eventIdentifier) {
        console.error("Missing required fields for delete_event intent")
        return { intent: "other" }
      }

      if (intentData.intent === "query_events" && !intentData.queryParams) {
        console.error("Missing required fields for query_events intent")
        return { intent: "other" }
      }

      return intentData
    } catch (parseError) {
      console.error("Error parsing AI intent determination:", parseError)
      return { intent: "other" }
    }
  } catch (error) {
    console.error("Error determining calendar intent:", error)
    return { intent: "other" }
  }
}


async function findEventByIdentifier(userId: string, eventIdentifier: string): Promise<any> {
  try {

    const today = new Date()
    const startDate = new Date(today)
    startDate.setDate(today.getDate() - 7)

    const endDate = new Date(today)
    endDate.setDate(today.getDate() + 30)

    const events = await calendarTools.getEvents(userId, startDate, endDate)

    if (!events || !events.events || events.events.length === 0) {
      return null
    }

    const lowerIdentifier = eventIdentifier.toLowerCase()


    const exactMatch = events.events.find((event: any) => event.title && event.title.toLowerCase() === lowerIdentifier)

    if (exactMatch) {
      return exactMatch
    }


    const partialMatch = events.events.find(
      (event: any) => event.title && event.title.toLowerCase().includes(lowerIdentifier),
    )

    if (partialMatch) {
      return partialMatch
    }


    if (lowerIdentifier.includes("today")) {

      const todayEvents = events.events.filter((event: any) => {
        const eventDate = new Date(event.start)
        return (
          eventDate.getDate() === today.getDate() &&
          eventDate.getMonth() === today.getMonth() &&
          eventDate.getFullYear() === today.getFullYear()
        )
      })

      if (todayEvents.length === 1) {
        return todayEvents[0]
      }


      if (todayEvents.length > 0) {
        return todayEvents[0]
      }
    }


    if (lowerIdentifier.includes("tomorrow")) {
      const tomorrow = new Date(today)
      tomorrow.setDate(today.getDate() + 1)


      const tomorrowEvents = events.events.filter((event: any) => {
        const eventDate = new Date(event.start)
        return (
          eventDate.getDate() === tomorrow.getDate() &&
          eventDate.getMonth() === tomorrow.getMonth() &&
          eventDate.getFullYear() === tomorrow.getFullYear()
        )
      })

      if (tomorrowEvents.length === 1) {
        return tomorrowEvents[0]
      }


      if (tomorrowEvents.length > 0) {
        return tomorrowEvents[0]
      }
    }


    return null
  } catch (error) {
    console.error("Error finding event by identifier:", error)
    return null
  }
}
