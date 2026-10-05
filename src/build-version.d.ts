declare module 'virtual:build-version' {
  export const BUILD_VERSION: string;
}

/** The package.json version, a release's calendar version (docs/deployment.md); set by `define` in vite.config.ts. */
declare const __APP_VERSION__: string;
