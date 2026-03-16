import { redirect } from "next/navigation"
import { getServerSession } from "next-auth/next"
import { authOptions } from "@/lib/auth"
import { MultiCalendarView } from "@/components/multi-calendar-view"
import { getEvents, getUserCategories } from "@/lib/calendar"
import { CalendarHeader } from "@/components/calendar-header"
import { Sidebar } from "@/components/sidebar"

export default async function CalendarPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect("/auth/signin")
  }

  const today = new Date()
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)

  const events = await getEvents(session.user.id, startOfMonth, endOfMonth)
  const categories = await getUserCategories(session.user.id)

  return (
    <div className="flex h-screen flex-col">
      <CalendarHeader />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto p-4">
          <MultiCalendarView initialEvents={events} initialCategories={categories.map((c) => c.name)} />
        </main>
      </div>
    </div>
  )
}
