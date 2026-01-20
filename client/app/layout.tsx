import type React from "react"
import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Analytics } from "@vercel/analytics/next"
import { Toaster } from "@/components/ui/toaster"
import { Suspense } from "react"
import { ConvexClientProvider } from "@/lib/convex/ConvexClientProvider"
import "./globals.css"

export const metadata: Metadata = {
  title: "TropX Motion",
  description: "Motion tracking and analysis platform",
  generator: "TropX",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        <ConvexClientProvider>
          <Suspense fallback={null}>
            {children}
            <Analytics />
            <Toaster />
          </Suspense>
        </ConvexClientProvider>
      </body>
    </html>
  )
}
