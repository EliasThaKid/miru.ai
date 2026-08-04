import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only. Next blocks cross-origin requests to its internal dev resources (HMR socket,
  // /_next/*) unless the origin is allow-listed, so loading the dev server over the LAN IP
  // instead of localhost — testing on a phone, say — breaks hot reload. Subnet wildcard
  // rather than a single IP so a DHCP reassignment doesn't reintroduce the failure. Has no
  // effect on production builds.
  allowedDevOrigins: ['192.168.1.*'],
};

export default nextConfig;
