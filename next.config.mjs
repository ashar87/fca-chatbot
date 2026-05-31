/** @type {import('next').NextConfig} */
const nextConfig = {
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
