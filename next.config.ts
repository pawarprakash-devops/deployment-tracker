import type { NextConfig } from "next";

// Only Deployments (/) and Insights (/?tab=insights). Old URLs redirect cleanly.
const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/classic", destination: "/", permanent: false },
      { source: "/jira", destination: "/", permanent: false },
      { source: "/tickets", destination: "/", permanent: false },
      { source: "/health", destination: "/", permanent: false },
      { source: "/home", destination: "/", permanent: false },
      { source: "/pipeline", destination: "/", permanent: false },
      { source: "/my-view", destination: "/", permanent: false },
      { source: "/admin", destination: "/?tab=insights", permanent: false },
    ];
  },
};

export default nextConfig;
