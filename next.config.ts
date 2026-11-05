import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // These load their data files from disk at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector", "pdfkit", "jsdom"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
