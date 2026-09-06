import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pg — нативный драйвер, его нельзя бандлить в серверные компоненты.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
