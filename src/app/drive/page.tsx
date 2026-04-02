"use client";

import dynamic from "next/dynamic";

const DriveClient = dynamic(() => import("@/components/drive-client"), {
  ssr: false,
});

export default function DrivePage() {
  return <DriveClient />;
}
