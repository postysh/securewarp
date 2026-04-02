"use client";

import { ThemeProvider } from "@/components/theme-provider";

export default function Home() {
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-bg-side" />
    </ThemeProvider>
  );
}
