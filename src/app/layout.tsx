import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

// Geist stays as the system fallback chain (referenced by some
// existing inline styles via --font-geist-sans). Chillax is the
// primary brand font.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Chillax (Indian Type Foundry / Fontshare) — variable font covers
// all weights from Extralight (200) through Bold (700) in a single
// ~55 KB woff2 file. Self-hosted from /public/fonts/ so we don't add
// a third-party font CDN to connect-src.
const chillax = localFont({
  src: "../../public/fonts/Chillax-Variable.woff2",
  variable: "--font-chillax",
  display: "swap",
  weight: "200 700",
});

export const metadata: Metadata = {
  title: "Securewarp | Cloud storage, not cloud surveillance",
  description: "Zero-knowledge encrypted cloud storage",
  // Explicit icon URLs with a version query so browsers that cache
  // favicons outside the HTTP cache (Safari's dedicated favicon
  // store, Chrome's SQLite DB) get a fresh fetch on any version
  // bump. Change the `v=` value when the logo changes.
  icons: {
    icon: [
      { url: "/icon.svg?v=2", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/apple-icon?v=2", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Pre-hydration script. Reads the user's saved theme from localStorage
// and sets `dark` on <html> BEFORE React paints, so returning dark-theme
// users don't see a flash-of-light-theme on every refresh. Kept in sync
// with src/components/theme-provider.tsx (same STORAGE_KEY + class).
// Wrapped in try/catch because localStorage throws in privacy modes.
const themeBootScript = `try{var t=localStorage.getItem('securewarp-theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${chillax.variable} ${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="h-full antialiased">
        {children}
      </body>
    </html>
  );
}
