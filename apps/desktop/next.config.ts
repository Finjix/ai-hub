import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'export', trailingSlash: true, images: { unoptimized: true },
  transpilePackages: ['@ai-hub/shared'],
  experimental: { cpus: 2 },
};
export default config;
