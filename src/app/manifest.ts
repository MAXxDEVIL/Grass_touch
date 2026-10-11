import type { MetadataRoute } from "next";

/** The manifest that lets a phone install the game like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Impostor Hunt",
    short_name: "Impostor Hunt",
    description:
      "Real-time location-based social deduction: five players, one impostor, one neighbourhood.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0f14",
    theme_color: "#0b0f14",
    orientation: "portrait",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}