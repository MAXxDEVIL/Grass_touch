import { ImageResponse } from "next/og";

// The app icon: a sighting reticle on the night palette, drawn once at build
// time and served for both the browser tab and the phone's home screen.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0b0f14",
      }}
    >
      <div
        style={{
          width: 288,
          height: 288,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "14px solid #6c8cff",
          borderRadius: 9999,
        }}
      >
        <div
          style={{
            width: 160,
            height: 160,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "14px solid #7cff6b",
            borderRadius: 9999,
          }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              background: "#f4f7fa",
              borderRadius: 9999,
            }}
          />
        </div>
      </div>
    </div>,
    { ...size },
  );
}