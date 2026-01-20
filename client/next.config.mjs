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
  // Transpile convex packages for proper bundling
  transpilePackages: ['convex', '@convex-dev/auth'],
}

export default nextConfig
