import type { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import CredentialsProvider from "next-auth/providers/credentials"
import { kv } from "@/lib/kv-config"
import bcrypt from "bcryptjs"
import crypto from "crypto"
import { getServerSession } from "next-auth/next"

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/calendar",
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await getUserByEmail(credentials.email)

        if (!user) {
          return null
        }

        const isPasswordValid = await bcrypt.compare(credentials.password, user.password)

        if (!isPasswordValid) {
          return null
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      if (account) {
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        token.expiresAt = account.expires_at
        token.provider = account.provider

        if (account.provider === "google" && user) {
          console.log("[Auth] Storing Google credentials to KV for user:", user.id)
          try {
            await kv.hset(`user:${user.id}`, {
              provider: account.provider,
              accessToken: account.access_token,
              refreshToken: account.refresh_token,
              expiresAt: account.expires_at,
            })
            console.log("[Auth] Google credentials stored successfully")
          } catch (err) {
            console.error("[Auth] Failed to store Google credentials:", err)
          }
        } else {
          console.log("[Auth] Skipping KV store — provider:", account.provider, "user:", !!user)
        }
      }

      if (user) {
        token.id = user.id
      }

      return token
    },
    async session({ session, token }) {
      session.user.id = token.id as string
      session.user.accessToken = token.accessToken as string
      session.user.refreshToken = token.refreshToken as string
      session.user.expiresAt = token.expiresAt as number
      session.user.provider = token.provider as string
      return session
    },
  },
  pages: {
    signIn: "/auth/signin",
    signUp: "/auth/signup",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
}

export async function getUserByEmail(email: string) {
  const userId = await kv.get(`email:${email}`)
  if (!userId) return null

  const user = await kv.hgetall(`user:${userId}`)
  return user ? { ...user, id: userId } : null
}

export async function createUser(name: string, email: string, password: string) {
  const hashedPassword = await bcrypt.hash(password, 10)
  const randomString = crypto.randomBytes(6).toString("base64url") // Generate a secure random string
  const userId = `user_${Date.now()}_${randomString}`

  await kv.hset(`user:${userId}`, {
    id: userId,
    name,
    email,
    password: hashedPassword,
    createdAt: Date.now(),
  })

  await kv.set(`email:${email}`, userId)

  return { id: userId, name, email }
}

export async function saveUserPreferences(userId: string, preferences: any) {

  if (!preferences.timezone) {
    try {

      preferences.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    } catch (error) {
      preferences.timezone = "UTC"
    }
  }

  await kv.hset(`user:${userId}`, { preferences: JSON.stringify(preferences) })
}

export async function getUserPreferences(userId: string) {
  const data = await kv.hgetall(`user:${userId}`)
  return data?.preferences ? JSON.parse(data.preferences as string) : {}
}


export async function getUserTimezone(userId: string): Promise<string> {
  try {
    const userData = await kv.hgetall(`user:${userId}`)
    if (userData?.preferences) {
      const preferences = JSON.parse(userData.preferences as string)
      return preferences.timezone || "UTC"
    }
    return "UTC"
  } catch (error) {
    console.error("Error getting user timezone:", error)
    return "UTC"
  }
}


export async function auth() {
  return await getServerSession(authOptions)
}
