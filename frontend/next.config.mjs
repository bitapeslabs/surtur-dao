import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// WASM setup mirrors subfrost-app/next.config.mjs — the alkanes WASM SDK is
// vendored at lib/alkanes-web-sys/ (copied from subfrost-app/lib/oyl/alkanes)
// and imported directly, so no @alkanes/ts-sdk/wasm alias is needed here.
const nextConfig = {
  reactStrictMode: false,
  // Mandarin locale lives under /zh — same pages, the client derives the
  // locale from the URL (see i18n.ts). English stays unprefixed.
  async rewrites() {
    return [{ source: '/zh/:path*', destination: '/:path*' }];
  },
  async redirects() {
    return [{ source: '/zh', destination: '/zh/proposals', permanent: false }];
  },
  transpilePackages: ['subfrost-connect', '@alkanes/ts-sdk', '@surtur/shared'],
  typescript: {
    ignoreBuildErrors: false,
  },
  experimental: {
    // Turbopack's persistent dev cache has repeatedly served stale compiled
    // CSS after globals.css edits (requiring `rm -rf .next`). Trade cold
    // start speed for correctness.
    turbopackFileSystemCacheForDev: false,
  },
  turbopack: {
    // Monorepo: the workspace root (where the pnpm store lives) — Next
    // needs it to resolve packages hoisted above frontend/.
    root: path.join(__dirname, '..'),
    resolveAlias: {
      // Stub out Node.js built-in modules for browser builds
      fs: { browser: './lib/empty-module.js' },
      path: { browser: './lib/empty-module.js' },
      net: { browser: './lib/empty-module.js' },
      tls: { browser: './lib/empty-module.js' },
      crypto: { browser: './lib/empty-module.js' },
      stream: { browser: './lib/empty-module.js' },
      util: { browser: './lib/empty-module.js' },
    },
  },
  webpack: (config, { isServer, webpack }) => {
    // WASM support
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    config.output.webassemblyModuleFilename =
      (isServer ? '../' : '') + 'static/wasm/[modulehash].wasm';
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'webassembly/async',
    });

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        'node:crypto': false,
        stream: false,
        path: false,
        util: false,
      };
      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
          process: 'process/browser',
        })
      );
      config.plugins.push(
        new webpack.DefinePlugin({
          global: 'globalThis',
        })
      );
    }

    return config;
  },
};

export default nextConfig;
