/**
 * Channel Event Emission Module
 *
 * Enables MCP servers to push real-time events to mctx channel subscribers.
 * Events are written as X-Mctx-Event response headers. The dispatch worker
 * reads these headers and writes events to D1. No HTTP calls or env vars required.
 *
 * Events are delivered via response headers (X-Mctx-Event, X-Mctx-Cancel)
 * intercepted by the mctx dispatch worker — no outbound HTTP calls are made.
 *
 * @module channel
 */

/**
 * Regex pattern for valid metadata keys.
 * Keys must consist of alphanumeric characters and underscores only.
 * Hyphens are silently dropped by some environments, so we reject them explicitly.
 *
 * Note: This same pattern governs the `key` field (idempotency identifier).
 * The `key` field is a developer-supplied idempotency identifier (e.g. "deploy_123"),
 * NOT an event ID reference. UUIDs are NOT valid keys because they contain hyphens
 * (e.g. "550e8400-e29b-41d4-a716-446655440000" would fail this pattern).
 */
export const META_KEY_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * Default event type when not specified by the developer.
 */
const DEFAULT_EVENT_TYPE = "channel";

/**
 * Maximum allowed content length (display_text max 500 chars).
 */
const MAX_CONTENT_LENGTH = 500;

/**
 * Default event TTL in milliseconds (7 days).
 */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Creates an emit function that appends X-Mctx-Event response headers.
 *
 * Each call to emit() appends ONE X-Mctx-Event header with ONE JSON object
 * representing the event. The dispatch worker reads these headers and writes
 * the events to D1.
 *
 * Returns a no-op function when responseHeaders is not provided.
 *
 * @param {Headers} responseHeaders - The Response Headers object to append events to
 * @returns {Function} Synchronous emit function returning an eventId string
 *
 * @example
 * // In a Cloudflare Worker fetch handler
 * const responseHeaders = new Headers(SECURITY_HEADERS);
 * const emit = createEmit(responseHeaders);
 * const eventId = emit("User completed onboarding", { eventType: "milestone", meta: { user_id: "u_123" } });
 */
export function createEmit(responseHeaders) {
  if (!responseHeaders || typeof responseHeaders.append !== "function") {
    return function noopEmit(_content, _options) {
      return "";
    };
  }

  /**
   * Emit a channel event by appending an X-Mctx-Event response header.
   *
   * emit(content, options?)
   *   - content: display text (non-empty string, truncated at 500 chars)
   *   - options.eventType: override the event type (default: 'channel')
   *   - options.meta: key/value metadata record
   *   - options.deliverAt: ISO timestamp string for scheduled delivery
   *   - options.key: correlation key for deduplication/cancellation
   *
   * Returns the eventId (UUID) synchronously.
   * Invalid inputs and header errors are silently swallowed (no-op returning "").
   *
   * @param {string} content - Display text for the event
   * @param {{ eventType?: string; meta?: Record<string,string>; deliverAt?: string; key?: string }} [options] - Event options
   * @returns {string} eventId (UUID string), or "" on no-op
   */
  return function emit(content, options) {
    // Validate content is a non-empty string; silently no-op on invalid
    if (typeof content !== "string" || content.length === 0) return "";

    // Truncate content to max allowed length
    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.slice(0, MAX_CONTENT_LENGTH);
    }

    let eventType = DEFAULT_EVENT_TYPE;
    let metadata = null;
    let deliverAt = null;
    let key = null;

    if (options !== undefined && options !== null && typeof options === "object") {
      // Validate eventType format; default to 'channel' if invalid
      if (options.eventType !== undefined) {
        if (typeof options.eventType === "string" && META_KEY_PATTERN.test(options.eventType)) {
          eventType = options.eventType;
        }
        // else: silently default to 'channel'
      }

      // Validate meta keys and values; silently no-op on any violation
      // Developer passes options.meta; Serialized as metadata in the JSON header
      // per dispatch worker contract.
      if (options.meta !== undefined && options.meta !== null) {
        for (const [k, value] of Object.entries(options.meta)) {
          if (!META_KEY_PATTERN.test(k) || typeof value !== "string") {
            return ""; // silently no-op — fire-and-forget contract
          }
        }
        metadata = options.meta;
      }

      // Validate deliverAt: must be a non-empty string matching basic ISO 8601 pattern
      // Pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/ — requires at minimum
      // YYYY-MM-DDTHH:MM:SS prefix. Invalid values are silently set to null.
      if (options.deliverAt !== undefined) {
        if (
          typeof options.deliverAt === "string" &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(options.deliverAt)
        ) {
          deliverAt = options.deliverAt;
        }
        // else: silently set to null
      }

      // Validate key: must be a non-empty string matching META_KEY_PATTERN
      if (options.key !== undefined) {
        if (
          typeof options.key === "string" &&
          options.key.length > 0 &&
          META_KEY_PATTERN.test(options.key)
        ) {
          key = options.key;
        }
        // else: silently set to null
      }
    }

    const eventId = crypto.randomUUID();
    // TTL starts at emit time (when the response header is written),
    // not at dispatch time (when the worker reads and stores the event).
    const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString();

    const event = {
      eventId,
      eventType,
      content,
      metadata,
      deliverAt,
      expiresAt,
      key,
    };

    try {
      responseHeaders.append("X-Mctx-Event", JSON.stringify(event));
    } catch {
      // Silently swallow header append errors
      return "";
    }

    return eventId;
  };
}

/**
 * Creates a cancel function that appends X-Mctx-Cancel response headers.
 *
 * Each call to cancel() appends ONE X-Mctx-Cancel header with the eventId
 * as a plain string value. The dispatch worker reads these headers and
 * cancels the matching pending events in D1.
 *
 * Returns a no-op function when responseHeaders is not provided.
 *
 * @param {Headers} responseHeaders - The Response Headers object to append cancellations to
 * @returns {Function} Synchronous cancel function
 *
 * @example
 * // In a Cloudflare Worker fetch handler
 * const responseHeaders = new Headers(SECURITY_HEADERS);
 * const cancel = createCancel(responseHeaders);
 * cancel(eventId);
 */
export function createCancel(responseHeaders) {
  if (!responseHeaders || typeof responseHeaders.append !== "function") {
    return function noopCancel(_eventId) {
      // Silently do nothing — responseHeaders not available
    };
  }

  /**
   * Cancel a pending scheduled channel event by eventId.
   *
   * cancel(eventId)
   *   - eventId: the eventId returned by a previous emit() call (non-empty string)
   *
   * Invalid inputs are silently swallowed (no-op).
   *
   * @param {string} eventId - The eventId to cancel
   * @returns {void}
   */
  return function cancel(eventId) {
    // Validate eventId is a non-empty string; silently no-op on invalid
    if (typeof eventId !== "string" || eventId.length === 0) return;

    try {
      responseHeaders.append("X-Mctx-Cancel", eventId);
    } catch {
      // Silently swallow header append errors
    }
  };
}
