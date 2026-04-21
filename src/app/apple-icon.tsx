import { ImageResponse } from "next/og";

/**
 * Apple touch icon — 180×180 PNG, generated at build time from the
 * same orange/coral chevron marks as `icon.svg`. Served at
 * `/apple-icon` and referenced from layout.tsx's metadata.icons so
 * iOS home-screen bookmarks + Safari pinned tabs pick up the brand
 * glyph instead of a generic OS fallback.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 40,
        }}
      >
        <svg
          width="140"
          height="140"
          viewBox="115 140 145 100"
          preserveAspectRatio="xMidYMid meet"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill="#ef5a3c"
            d="M 228.265625 154.761719 L 168.773438 214.253906 L 180.21875 225.703125 C 183.457031 228.9375 188.699219 228.9375 191.933594 225.703125 L 251.425781 166.210938 L 239.980469 154.761719 C 236.742188 151.527344 231.5 151.527344 228.265625 154.761719 Z"
          />
          <path
            fill="#e18c6e"
            d="M 181.859375 154.964844 L 145.671875 191.152344 L 162.976562 208.457031 L 205.019531 166.410156 L 193.574219 154.964844 C 190.339844 151.726562 185.09375 151.726562 181.859375 154.964844 Z"
          />
          <path
            fill="#eba587"
            d="M 140.488281 150.132812 L 124.757812 165.859375 C 123.546875 167.070312 123.546875 169.03125 124.757812 170.238281 L 139.875 185.355469 L 163.648438 161.582031 L 152.199219 150.132812 C 148.964844 146.898438 143.722656 146.898438 140.488281 150.132812 Z"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
