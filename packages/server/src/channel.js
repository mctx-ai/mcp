/**
 * Channel Event Emission Module
 *
 * Enables MCP servers to push real-time events to mctx channel subscribers.
 * Provides the `emit` function for tools via `ctx.emit` and the `cancel`
 * function via `ctx.cancel` for cancelling pending scheduled events.
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
 * Regex pattern for valid UUID v4 strings (case-insensitive).
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
   *   - options.deliverAt: Unix timestamp (ms) for scheduled delivery; must be a positive number
   *   - options.key: correlation key matching META_KEY_PATTERN or UUID; used for deduplication/cancellation
   *
   * Fire-and-forget: uses executionCtx.waitUntil() when available.
   * Invalid inputs and HTTP errors are silently swallowed (no-op).
   *
   * @param {string} content - Display text for the event
   * @param {{ eventType?: string; meta?: Record<string,string>; deliverAt?: number; key?: string }} [options] - Event options
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
    let deliverAt = null;
    let key = null;

    if (options !== undefined && options !== null && typeof options === "object") {
      // M-1: validate eventType format; default to 'notification' if invalid
      if (options.eventType !== undefined) {
        if (typeof options.eventType === "string" && META_KEY_PATTERN.test(options.eventType)) {
          eventType = options.eventType;
        }
        // else: silently default to 'notification'
      }
      meta = options.meta;

      // Validate deliverAt: must be a positive number if provided
      if (options.deliverAt !== undefined) {
        if (typeof options.deliverAt === "number" && options.deliverAt > 0) {
          deliverAt = options.deliverAt;
        }
        // else: silently set to null
      }

      // Validate key: must be a non-empty string matching META_KEY_PATTERN or UUID pattern
      if (options.key !== undefined) {
        if (
          typeof options.key === "string" &&
          options.key.length > 0 &&
          (META_KEY_PATTERN.test(options.key) || UUID_PATTERN.test(options.key))
        ) {
          key = options.key;
        }
        // else: silently set to null
      }
    }

    // B-1 / M-2: validate meta keys and values; silently no-op on any violation
    if (meta !== undefined && meta !== null) {
      for (const [k, value] of Object.entries(meta)) {
        if (!META_KEY_PATTERN.test(k) || typeof value !== "string") {
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
      deliver_at: deliverAt,
      key,
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

/**
 * Creates a cancel function bound to the given Cloudflare Worker environment
 * and execution context.
 *
 * Returns a no-op function when required environment variables are missing
 * (MCTX_EVENTS_ENDPOINT, MCTX_SERVER_ID, MCTX_EVENTS_SECRET) or when the
 * secret is too short (minimum 32 characters).
 *
 * @param {Object} env - Cloudflare Worker environment bindings
 * @param {Object} [executionCtx] - Cloudflare Worker execution context
 * @returns {Function} Async cancel function
 *
 * @example
 * // In a Cloudflare Worker fetch handler
 * const cancel = createCancel(env, ctx);
 * await cancel("my-event-key");
 */
export function createCancel(env, executionCtx) {
  // No-op when any required config is missing
  if (!env || !env.MCTX_EVENTS_ENDPOINT || !env.MCTX_SERVER_ID || !env.MCTX_EVENTS_SECRET) {
    return async function noopCancel(_key) {
      // Silently do nothing — channel not configured
    };
  }

  // No-op when secret is too short (configuration error — fail safely)
  if (env.MCTX_EVENTS_SECRET.length < 32) {
    return async function noopCancel(_key) {
      // Silently do nothing — secret too short
    };
  }

  // Cache the imported CryptoKey across cancel invocations to avoid per-call overhead
  const keyCache = { key: null };

  /**
   * Cancel a pending scheduled channel event by key.
   *
   * cancel(key)
   *   - key: correlation key of the event to cancel (non-empty string)
   *
   * Fire-and-forget: uses executionCtx.waitUntil() when available.
   * Invalid inputs and HTTP errors are silently swallowed (no-op).
   *
   * @param {string} key - Correlation key of the event to cancel
   * @returns {Promise<void>}
   */
  return async function cancel(key) {
    // Validate key is a non-empty string; silently no-op on invalid
    if (typeof key !== "string" || key.length === 0) return;

    const nonce = crypto.randomUUID();

    const payload = {
      server_id: env.MCTX_SERVER_ID,
      key,
      nonce,
    };

    const body = JSON.stringify(payload);

    const sendCancel = async () => {
      try {
        const signature = await signBody(body, env.MCTX_EVENTS_SECRET, keyCache);

        await fetch(`${env.MCTX_EVENTS_ENDPOINT}/cancel`, {
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
      executionCtx.waitUntil(sendCancel());
    } else {
      // Non-Worker environment: fire without await (best-effort)
      sendCancel();
    }
  };
}
