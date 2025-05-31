/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: [
    'http://localhost:3000',
    'http://192.168.29.138:3000',
    'https://192.168.29.138:3001',
    'http://192.168.29.138:3001',
  ],
}

export default nextConfig
