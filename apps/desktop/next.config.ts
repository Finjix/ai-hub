import type { NextConfig } from 'next';
const config: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  output: 'export', trailingSlash: true, images: { unoptimized: true },
  transpilePackages: ['@ai-hub/shared'],
  experimental: { cpus: 2 },
};
export default config;
