import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CodeAtlas — understand your codebase',
  description: 'A visual guide to your repository architecture.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
