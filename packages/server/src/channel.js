/**
 * Channel Event Emission Module
 *
 * Enables MCP servers to push real-time events to mctx channel subscribers.
 * Provides the `emit` function for tools via `ctx.emit`.
 *
 * @module channel
 */

/**
 * Regex pattern for valid metadata keys.
 * Keys must consist of alphanumeric characters and underscores only.
 * Hyphens are silently dropped by some environments, so we reject them explicitly.
 */
export const META_KEY_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * Default event type when not specified.
 */
const DEFAULT_EVENT_TYPE = "notification";

/**
 * Maximum allowed content length (display_text max 500 chars).
 */
const MAX_CONTENT_LENGTH = 500;

/**
 * Sign a message body with HMAC-SHA256 using the Web Crypto API.
 * Caches the imported CryptoKey across calls to avoid per-invocation overhead.
 *
 * @param {string} body - Raw JSON string to sign
 * @param {string} secret - HMAC secret key
 * @param {{ key: CryptoKey|null }} keyCache - Mutable cache object shared across calls
 * @returns {Promise<string>} Hex-encoded HMAC-SHA256 signature
 */
async function signBody(body, secret, keyCache) {
  const encoder = new TextEncoder();

  if (!keyCache.key) {
    const keyData = encoder.encode(secret);
    keyCache.key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }

  const messageData = encoder.encode(body);
  const signature = await crypto.subtle.sign("HMAC", keyCache.key, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Creates an emit function bound to the given Cloudflare Worker environment
 * and execution context.
 *
 * Returns a no-op function when required environment variables are missing
 * (MCTX_EVENTS_ENDPOINT, MCTX_SERVER_ID, MCTX_EVENTS_SECRET) or when the
 * secret is too short (minimum 32 characters).
 *
 * @param {Object} env - Cloudflare Worker environment bindings
 * @param {Object} [executionCtx] - Cloudflare Worker execution context
 * @returns {Function} Async emit function
 *
 * @example
 * // In a Cloudflare Worker fetch handler
 * const emit = createEmit(env, ctx);
 * await emit("User completed onboarding", { eventType: "milestone", meta: { user_id: "u_123" } });
 */
export function createEmit(env, executionCtx) {
  // No-op when any required config is missing
  if (!env || !env.MCTX_EVENTS_ENDPOINT || !env.MCTX_SERVER_ID || !env.MCTX_EVENTS_SECRET) {
    return async function noopEmit(_content, _options) {
      // Silently do nothing — channel not configured
    };
  }

  // No-op when secret is too short (configuration error — fail safely)
  if (env.MCTX_EVENTS_SECRET.length < 32) {
    return async function noopEmit(_content, _options) {
      // Silently do nothing — secret too short
    };
  }

  // Cache the imported CryptoKey across emit invocations to avoid per-call overhead (M-4)
  const keyCache = { key: null };

  /**
   * Emit a channel event.
   *
   * emit(content, options?)
   *   - content: display text (non-empty string, truncated at 500 chars)
   *   - options.eventType: override the event type (default: 'notification')
   *   - options.meta: key/value metadata record
   *
   * Fire-and-forget: uses executionCtx.waitUntil() when available.
   * Invalid inputs and HTTP errors are silently swallowed (no-op).
   *
   * @param {string} content - Display text for the event
   * @param {{ eventType?: string; meta?: Record<string,string> }} [options] - Event options
   * @returns {Promise<void>}
   */
  return async function emit(content, options) {
    // H-2: validate content is a non-empty string; silently no-op on invalid
    if (typeof content !== "string" || content.length === 0) return;

    // H-2: truncate content to max allowed length
    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.slice(0, MAX_CONTENT_LENGTH);
    }

    let eventType = DEFAULT_EVENT_TYPE;
    let meta;

    if (options !== undefined && options !== null && typeof options === "object") {
      // M-1: validate eventType format; default to 'notification' if invalid
      if (options.eventType !== undefined) {
        if (typeof options.eventType === "string" && META_KEY_PATTERN.test(options.eventType)) {
          eventType = options.eventType;
        }
        // else: silently default to 'notification'
      }
      meta = options.meta;
    }

    // B-1 / M-2: validate meta keys and values; silently no-op on any violation
    if (meta !== undefined && meta !== null) {
      for (const [key, value] of Object.entries(meta)) {
        if (!META_KEY_PATTERN.test(key) || typeof value !== "string") {
          return; // silently no-op — fire-and-forget contract
        }
      }
    }

    const nonce = crypto.randomUUID();

    const payload = {
      server_id: env.MCTX_SERVER_ID,
      event_type: eventType,
      display_text: content,
      metadata: meta || null,
      nonce,
    };

    const body = JSON.stringify(payload);

    const sendEvent = async () => {
      try {
        const signature = await signBody(body, env.MCTX_EVENTS_SECRET, keyCache);

        // H-3: X-Events-Nonce header removed — nonce lives in the signed body only
        await fetch(env.MCTX_EVENTS_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Events-Signature": `sha256=${signature}`,
          },
          body,
        });
      } catch {
        // Silently swallow all HTTP and network errors
      }
    };

    if (executionCtx && typeof executionCtx.waitUntil === "function") {
      executionCtx.waitUntil(sendEvent());
    } else {
      // Non-Worker environment: fire without await (best-effort)
      sendEvent();
    }
  };
}
