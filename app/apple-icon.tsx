import { ImageResponse } from "next/og";

// iOS home-screen icon. Square and full-bleed: iOS rounds the corners itself.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#171a21" }}>
        <svg width="180" height="180" viewBox="0 0 32 32">
          <line
            x1="7"
            x2="25"
            y1="19"
            y2="19"
            stroke="#ffffff"
            strokeOpacity="0.35"
            strokeWidth="1.5"
            strokeDasharray="2 2.5"
          />
          <path
            d="M7 22 L12.5 16.5 L16.5 19.5 L25 10"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="25" cy="10" r="2.25" fill="#7fb4f0" />
        </svg>
      </div>
    ),
    size,
  );
}
