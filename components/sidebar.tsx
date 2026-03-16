"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  MessageCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CalendarIcon,
  CheckSquareIcon,
  UsersIcon,
  PlusIcon,
  ChevronDownIcon,
  LockIcon,
  AlertCircleIcon,
} from "lucide-react"
import { ChatPanel } from "./chat-panel"
import { cn } from "@/lib/utils"
import { Badge } from "./ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { useSession } from "next-auth/react"
import { createCalendar } from "@/lib/calendar"

type Calendar = {
  id: string
  name: string
  color: string
  visible: boolean
}

export function Sidebar() {
  const router = useRouter()
  const { data: session } = useSession()
  const [collapsed, setCollapsed] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [createCalendarOpen, setCreateCalendarOpen] = useState(false)
  const [newCalendarName, setNewCalendarName] = useState("")
  const [newCalendarColor, setNewCalendarColor] = useState("#3b82f6")
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [expandedSections, setExpandedSections] = useState({
    myCalendars: true,
    sharedCalendars: true,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)


  useEffect(() => {
    if (session?.user?.id) {
      fetchUserCalendars(session.user.id)
    }
  }, [session])

  const fetchUserCalendars = async (userId: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/calendars?userId=${userId}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch calendars: ${response.status}`)
      }

      const data = await response.json()
      const seen = new Set()
      setCalendars(data.calendars.filter((c: Calendar) => !seen.has(c.id) && seen.add(c.id)))
    } catch (error) {
      console.error("Failed to fetch calendars:", error)
      setError("Failed to load calendars. Please try again.")

      setCalendars([
        { id: "personal", name: "Personal", color: "#3b82f6", visible: true },
        { id: "work", name: "Work", color: "#10b981", visible: true },
        { id: "family", name: "Family", color: "#8b5cf6", visible: true },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateCalendar = async () => {
    if (!newCalendarName.trim() || !session?.user?.id) return

    try {
      const newCalendar = await createCalendar({
        userId: session.user.id,
        name: newCalendarName,
        color: newCalendarColor,
      })

      setCalendars([
        ...calendars,
        {
          id: newCalendar.id,
          name: newCalendar.name,
          color: newCalendar.color,
          visible: true,
        },
      ])
      setNewCalendarName("")
      setNewCalendarColor("#3b82f6")
      setCreateCalendarOpen(false)
    } catch (error) {
      console.error("Failed to create calendar:", error)
      setError("Failed to create calendar. Please try again.")
    }
  }

  const handleToggleCalendarVisibility = async (calendarId: string) => {
    if (!session?.user?.id) return

    try {

      const updatedCalendars = calendars.map((cal) => (cal.id === calendarId ? { ...cal, visible: !cal.visible } : cal))
      setCalendars(updatedCalendars)


      const response = await fetch("/api/calendars/toggle-visibility", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: session.user.id,
          calendarId,
        }),
      })

      if (!response.ok) {

        setCalendars(calendars)
        throw new Error("Failed to toggle calendar visibility")
      }


      router.refresh()
    } catch (error) {
      console.error("Failed to toggle calendar visibility:", error)
      setError("Failed to update calendar visibility. Please try again.")
    }
  }

  const toggleSection = (section: "myCalendars" | "sharedCalendars") => {
    setExpandedSections({
      ...expandedSections,
      [section]: !expandedSections[section],
    })
  }

  const navigateTo = (path: string) => {
    router.push(path)
  }

  const colorOptions = [
    "#3b82f6",
    "#10b981",
    "#ef4444",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#14b8a6",
  ]

  return (
    <>
      <div className={`relative border-r bg-card transition-all duration-300 ${collapsed ? "w-16" : "w-64"}`}>
        <div className="flex h-12 items-center justify-between border-b px-4">
          {!collapsed && <span className="font-medium">Calendars</span>}
          <Button
            variant="ghost"
            size="icon"
            className={collapsed ? "ml-auto" : ""}
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRightIcon className="h-4 w-4" /> : <ChevronLeftIcon className="h-4 w-4" />}
          </Button>
        </div>
        <ScrollArea className="h-[calc(100vh-7rem)]">
          <div className="px-3 py-2">
            {!collapsed ? (
              <>
                <div className="mb-4">
                  <Button
                    variant="ghost"
                    className="w-full justify-start mb-1 font-normal"
                    onClick={() => navigateTo("/calendar")}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    Calendar
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start mb-1 font-normal"
                    onClick={() => navigateTo("/tasks")}
                  >
                    <CheckSquareIcon className="mr-2 h-4 w-4" />
                    Tasks
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start font-normal"
                    onClick={() => navigateTo("/people")}
                  >
                    <UsersIcon className="mr-2 h-4 w-4" />
                    People
                  </Button>
                </div>
                <Separator className="my-4" />
                <div className="space-y-1">
                  <div
                    className="flex items-center justify-between py-1 px-2 cursor-pointer hover:bg-muted rounded-md"
                    onClick={() => toggleSection("myCalendars")}
                  >
                    <div className="flex items-center text-sm font-medium">
                      <ChevronDownIcon
                        className={`h-4 w-4 mr-1 transition-transform ${expandedSections.myCalendars ? "" : "transform rotate-[-90deg]"}`}
                      />
                      My Calendars
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation()
                        setCreateCalendarOpen(true)
                      }}
                    >
                      <PlusIcon className="h-4 w-4" />
                    </Button>
                  </div>
                  {expandedSections.myCalendars && (
                    <div className="space-y-1 ml-2">
                      {isLoading ? (
                        <div className="py-2 text-sm text-muted-foreground">Loading calendars...</div>
                      ) : error ? (
                        <div className="py-2 text-sm text-red-500 flex items-center gap-1">
                          <AlertCircleIcon className="h-3 w-3" />
                          {error}
                        </div>
                      ) : (
                        calendars.map((calendar) => (
                          <div
                            key={calendar.id}
                            className="flex items-center py-1 px-2 rounded-md hover:bg-muted cursor-pointer"
                            onClick={() => handleToggleCalendarVisibility(calendar.id)}
                          >
                            <span
                              className={`mr-2 h-3 w-3 rounded-full`}
                              style={{
                                backgroundColor: calendar.color,
                                opacity: calendar.visible ? 1 : 0.4,
                              }}
                            />
                            <span className={`text-sm ${calendar.visible ? "" : "text-muted-foreground"}`}>
                              {calendar.name}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <div className="space-y-1 mt-4">
                  <div
                    className="flex items-center justify-between py-1 px-2 cursor-pointer hover:bg-muted rounded-md"
                    onClick={() => toggleSection("sharedCalendars")}
                  >
                    <div className="flex items-center text-sm font-medium">
                      <ChevronDownIcon
                        className={`h-4 w-4 mr-1 transition-transform ${expandedSections.sharedCalendars ? "" : "transform rotate-[-90deg]"}`}
                      />
                      Shared Calendars
                    </div>
                  </div>
                  {expandedSections.sharedCalendars && (
                    <div className="ml-2 py-2 px-2">
                      <div className="flex items-center gap-2">
                        <LockIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground italic">Coming soon</span>
                        <Badge variant="outline" className="text-xs bg-muted text-muted-foreground ml-1">
                          Beta
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center space-y-4 mt-4">
                <Button variant="ghost" size="icon" className="rounded-full" onClick={() => navigateTo("/calendar")}>
                  <CalendarIcon className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="icon" className="rounded-full" onClick={() => navigateTo("/tasks")}>
                  <CheckSquareIcon className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="icon" className="rounded-full" onClick={() => navigateTo("/people")}>
                  <UsersIcon className="h-5 w-5" />
                </Button>
                <Separator className="w-8" />
                {isLoading ? (
                  <div className="text-xs text-muted-foreground">Loading...</div>
                ) : (
                  calendars.map((calendar) => (
                    <div
                      key={calendar.id}
                      className={`h-3 w-3 rounded-full cursor-pointer`}
                      style={{
                        backgroundColor: calendar.color,
                        opacity: calendar.visible ? 1 : 0.4,
                      }}
                      onClick={() => handleToggleCalendarVisibility(calendar.id)}
                    />
                  ))
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full h-6 w-6"
                  onClick={() => setCreateCalendarOpen(true)}
                >
                  <PlusIcon className="h-4 w-4" />
                </Button>
                <Separator className="w-8" />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex flex-col items-center gap-1">
                        <LockIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Soon</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Shared calendars coming soon</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}
          </div>
        </ScrollArea>
        <div className="absolute bottom-4 left-0 right-0 flex justify-center">
          <Button
            variant="outline"
            size={collapsed ? "icon" : "default"}
            className={cn(
              collapsed ? "h-10 w-10" : "w-[calc(100%-2rem)]",
              "gap-2 transition-all duration-300 rounded-full",
            )}
            onClick={() => setShowChat(true)}
          >
            <MessageCircleIcon className="h-4 w-4" />
            {!collapsed && <span>AI Assistant</span>}
          </Button>
        </div>
      </div>

      <Dialog open={createCalendarOpen} onOpenChange={setCreateCalendarOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create New Calendar</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Calendar Name</Label>
              <Input
                id="name"
                value={newCalendarName}
                onChange={(e) => setNewCalendarName(e.target.value)}
                placeholder="Enter calendar name"
              />
            </div>
            <div className="grid gap-2">
              <Label>Calendar Color</Label>
              <div className="flex flex-wrap gap-2">
                {colorOptions.map((color) => (
                  <div
                    key={color}
                    className={`h-8 w-8 rounded-full cursor-pointer ${newCalendarColor === color ? "ring-2 ring-offset-2 ring-primary" : ""}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewCalendarColor(color)}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateCalendarOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateCalendar}>Create Calendar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChatPanel open={showChat} onOpenChange={setShowChat} />
    </>
  )
}
