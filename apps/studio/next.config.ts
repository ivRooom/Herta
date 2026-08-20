import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
];

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
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/birthday-card-presets/:asset',
          destination: '/api/birthday-card-presets/:asset',
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
