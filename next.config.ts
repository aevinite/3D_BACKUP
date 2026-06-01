import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root to THIS folder. A stray lockfile in the user's
  // home dir (C:\Users\rishi\package-lock.json) makes Turbopack otherwise
  // infer the wrong root, which has caused intermittent dev 500s / panics.
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "littlefrenchhouse.in" },
    ],
  },
};

export default nextConfig;
