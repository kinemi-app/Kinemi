import type { NextConfig } from "next";

/** The routes of the old Next frontend, and the studio page each one became (web/). */
const OLD_ROUTES: Record<string, string> = {
  "/studios": "/app/tools/",
  "/cinematic": "/app/tools/cinematic/",
  "/storyboard": "/app/tools/storyboard/",
  "/reshoot": "/app/tools/re-shoot/",
  "/genjutsu": "/app/tools/genjutsu/",
  "/presets": "/app/tools/presets/",
  "/soul": "/app/tools/soul/",
  "/cast": "/app/tools/ai-cast/",
  "/edit": "/app/tools/edit/",
  "/academy": "/app/tools/academy/",
  "/audio": "/app/tools/audio-studio/",
  "/ads": "/app/tools/marketing-studio/",
  "/fashion": "/app/tools/fashion-factory/",
  "/canvas": "/app/tools/canvas/",
  "/previz": "/app/tools/3d-previz/",
  "/studio": "/app/tools/supercomputer/",
  "/upscale": "/app/tools/upscale/",
};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Astro build's pages are folders (/app/tools/cinematic/). Next would strip that slash and
  // the frontend route would add it back: a loop. lib/web/static.ts owns trailing slashes.
  skipTrailingSlashRedirect: true,
  async redirects() {
    return Object.entries(OLD_ROUTES).map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    }));
  },
};

export default nextConfig;
