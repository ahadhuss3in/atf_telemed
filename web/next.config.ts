import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Next infers the workspace root by walking up for a lockfile. Running this
    // project inside a directory that has one further up (here: a pnpm-lock in
    // the home directory) makes it adopt that directory, which then shows up as
    // "ignored pnpm-lock.yaml" plus filesystem watching over unrelated files.
    root: path.resolve(__dirname),
  },
  /**
   * In development Next blocks cross-origin requests to /_next/* resources, and
   * the built-in allowlist only covers `localhost` — so opening the dev server
   * at http://127.0.0.1:3000 silently serves prerendered HTML that never
   * hydrates, which looks like the app is broken.
   *
   * The private-range wildcards are what let you open the dev server from a
   * phone on the same network to test a call between two devices. They only
   * affect `next dev`; the production build has no such check. Drop them if you
   * develop on untrusted networks.
   */
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*", "10.*.*.*"],
};

export default nextConfig;
