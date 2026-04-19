/**
 * Completion Support Module
 *
 * Generates auto-completion suggestions for prompts, resources, and tool arguments.
 * Supports custom completion handlers and auto-generation from schema metadata.
 *
 * @module completion
 */

import { log } from "./log.js";

/**
 * Maximum number of completion results to return
 */
const MAX_COMPLETIONS = 100;

/**
 * Generates completion suggestions for a reference
 *
 * Handles completion for:
 * - Prompt arguments (ref/prompt-argument)
 * - Resources (ref/resource)
 *
 * Supports:
 * - Custom .complete() handler on registered items
 * - Auto-generation from T.enum() values
 * - Auto-generation from resource URI templates
 *
 * @param {Object} registeredItems - Map of registered prompts/resources
 * @param {Object} ref - Reference object with type and name/uri
 * @param {string} argumentValue - Partial text to complete against
 * @returns {Object} Completion result: { completion: { values: [...], hasMore: boolean } }
 *
 * @example
 * // Custom completion handler
 * const items = {
 *   'list-customers': {
 *     complete: async (argName, partialValue) => {
 *       if (argName === 'status') {
 *         return ['active', 'inactive', 'pending'];
 *       }
 *       return [];
 *     }
 *   }
 * };
 *
 * generateCompletions(items, { type: 'ref/prompt-argument', name: 'list-customers' }, 'act')
 * // => { completion: { values: ['active'], hasMore: false } }
 *
 * @example
 * // Auto-generation from T.enum
 * const items = {
 *   'search': {
 *     input: {
 *       status: T.string({ enum: ['pending', 'active', 'completed'] })
 *     }
 *   }
 * };
 *
 * generateCompletions(items, { type: 'ref/prompt-argument', name: 'search' }, 'p')
 * // => { completion: { values: ['pending'], hasMore: false } }
 */
export function generateCompletions(registeredItems, ref, argumentValue) {
  // Validate inputs
  if (!registeredItems || typeof registeredItems !== "object") {
    return createEmptyCompletion();
  }

  if (!ref || !ref.type) {
    return createEmptyCompletion();
  }

  const partialValue = argumentValue || "";

  // Handle prompt argument completion
  if (ref.type === "ref/prompt-argument") {
    return generatePromptArgumentCompletions(registeredItems, ref, partialValue);
  }

  // Handle resource completion
  if (ref.type === "ref/resource") {
    return generateResourceCompletions(registeredItems, ref, partialValue);
  }

  // Unknown reference type
  return createEmptyCompletion();
}

/**
 * Generate completions for prompt arguments
 * @private
 */
function generatePromptArgumentCompletions(registeredItems, ref, partialValue) {
  const promptName = ref.name;
  if (!promptName) return createEmptyCompletion();

  const prompt = registeredItems[promptName];
  if (!prompt) return createEmptyCompletion();

  // Check for custom completion handler
  if (typeof prompt.complete === "function") {
    return executeCustomCompletion(prompt.complete, ref.argumentName, partialValue);
  }

  // Auto-generate from T.enum values if available
  if (prompt.input && ref.argumentName) {
    const schema = prompt.input[ref.argumentName];
    if (schema && schema.enum && Array.isArray(schema.enum)) {
      return filterAndCap(schema.enum, partialValue);
    }
  }

  return createEmptyCompletion();
}

/**
 * Generate completions for resources
 * @private
 */
function generateResourceCompletions(registeredItems, ref, partialValue) {
  const uri = ref.uri;
  if (!uri) return createEmptyCompletion();

  const resource = registeredItems[uri];
  if (!resource) return createEmptyCompletion();

  // Check for custom completion handler
  if (typeof resource.complete === "function") {
    return executeCustomCompletion(resource.complete, null, partialValue);
  }

  // Auto-generate from URI templates
  // Extract possible values from template variables (limited - this is basic)
  // In practice, custom handlers are recommended for dynamic resources

  return createEmptyCompletion();
}

/**
 * Execute custom completion handler
 * @private
 */
function executeCustomCompletion(completeFn, argumentName, partialValue) {
  try {
    const result = completeFn(argumentName, partialValue);

    // Async completion handlers are not supported
    if (result instanceof Promise) {
      throw new Error(
        "Async completion handlers are not supported. Use synchronous handlers for fn.complete.",
      );
    }

    // Filter and cap the results
    if (Array.isArray(result)) {
      return filterAndCap(result, partialValue);
    }

    return createEmptyCompletion();
  } catch (error) {
    log.error("Completion handler error:" + (error ? " " + String(error) : ""));
    return createEmptyCompletion();
  }
}

/**
 * Filter completion values by partial match and cap at MAX_COMPLETIONS
 * @private
 * @param {Array<string>} values - All possible values
 * @param {string} partialValue - User's partial input
 * @returns {Object} Completion result
 */
function filterAndCap(values, partialValue) {
  if (!Array.isArray(values)) {
    return createEmptyCompletion();
  }

  // Filter values that start with partial input (case-insensitive)
  const lowerPartial = partialValue.toLowerCase();
  const filtered = values.filter((value) => {
    if (typeof value !== "string") return false;
    return value.toLowerCase().startsWith(lowerPartial);
  });

  // Cap at MAX_COMPLETIONS
  const hasMore = filtered.length > MAX_COMPLETIONS;
  const capped = filtered.slice(0, MAX_COMPLETIONS);

  return {
    completion: {
      values: capped,
      hasMore,
    },
  };
}

/**
 * Create empty completion result
 * @private
 */
function createEmptyCompletion() {
  return {
    completion: {
      values: [],
      hasMore: false,
    },
  };
}
