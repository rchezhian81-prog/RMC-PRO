import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server for a minimal production Docker image.
  // `outputFileTracingRoot` is the monorepo root so pnpm-workspace deps
  // (e.g. @rmc/shared) are traced into `.next/standalone`.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

export default nextConfig;
