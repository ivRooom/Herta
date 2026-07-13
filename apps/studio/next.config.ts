import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: [
    '@herta/shared',
    '@herta/ui',
    '@herta/plugin-catalog',
    '@herta/plugin-sdk',
    '@herta/plugin-auto-response',
    '@herta/plugin-daily-content',
    '@herta/plugin-lfg',
    '@herta/plugin-moderation',
    '@herta/plugin-quote',
    '@herta/plugin-team-split',
  ],
};

export default nextConfig;
