import type { NextConfig } from "next";

// Everything lives on one page with tabs (/?tab=...). Old URLs keep working.
const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/classic", destination: "/", permanent: false },
      { source: "/jira", destination: "/?tab=tickets", permanent: false },
      { source: "/admin", destination: "/?tab=insights", permanent: false },
      { source: "/health", destination: "/?tab=health", permanent: false },
      { source: "/home", destination: "/?tab=my-view", permanent: false },
      { source: "/pipeline", destination: "/?tab=pipeline", permanent: false },
    ];
  },
};

export default nextConfig;
