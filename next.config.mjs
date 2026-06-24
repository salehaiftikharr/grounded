/** @type {import('next').NextConfig} */
const nextConfig = {
  // Make sure the precomputed index ships with the /api/ask serverless function.
  outputFileTracingIncludes: {
    "/api/ask": ["./data/**"],
  },
};

export default nextConfig;
