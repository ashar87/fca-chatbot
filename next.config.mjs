/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prevent webpack from bundling packages that rely on native Node.js bindings
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse"],
  },

  async rewrites() {
    return [
      {
        source: "/fca-proxy/:path*",
        destination: "https://api.data.fca.org.uk/:path*",
      },
    ];
  },
};

export default nextConfig;
