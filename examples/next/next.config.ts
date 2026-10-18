import type { NextConfig } from 'next';

const config: NextConfig = {
  // `tsc` checks types before the build (see package.json): Next's own check
  // runs on TypeScript's JavaScript API, which TypeScript 7 doesn't have yet.
  typescript: { ignoreBuildErrors: true },
};

export default config;
