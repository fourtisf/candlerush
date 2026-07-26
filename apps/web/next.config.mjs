/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The engine ships as TypeScript source in the workspace; Next compiles it with the app
  // so the client and the server are provably running the same code.
  transpilePackages: ['@candle-rush/engine'],
  experimental: {
    optimizePackageImports: ['wagmi', 'viem'],
  },
};

export default nextConfig;
