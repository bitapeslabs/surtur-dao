/**
 * Snowfort app configuration.
 *
 * App-level settings (distinct from lib/config.ts, which holds Bitcoin
 * network / RPC config). Override at runtime via the header's connection
 * settings popover — this is the default the app starts with.
 */

/**
 * Origin of the SUBFROST app the connect/sign popups open against.
 * Must be a bare origin (scheme + host, no path or trailing slash).
 */
export const SUBFROST_ORIGIN = 'https://app.subfrost.io';
