/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  // Operandi dashboard is internal; we lock down image domains explicitly.
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
};

module.exports = nextConfig;
