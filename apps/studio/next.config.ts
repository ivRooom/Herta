import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@herta/shared', '@herta/ui'],
};

export default nextConfig;
