/**
 * Progress Notifications Module
 *
 * Provides progress tracking for long-running generator tool handlers.
 * Supports both determinate (with total) and indeterminate progress.
 *
 * @module progress
 */

/**
 * Default configuration for generator guardrails
 * Server will use these to prevent runaway generators
 */
export const PROGRESS_DEFAULTS = {
  maxExecutionTime: 60000, // 60 seconds
  maxYields: 10000,
};

/**
 * Creates a progress step function for generator-based tools
 *
 * Returns a function that produces progress notification objects.
 * Each call auto-increments the progress counter.
 *
 * @param {number} [total] - Total number of steps (optional, for determinate progress)
 * @returns {Function} Step function that returns progress notification objects
 *
 * @example
 * // Determinate progress (with known total)
 * function* migrate({ sourceDb, targetDb }, ask) {
 *   const tables = await getTables(sourceDb);
 *   const step = createProgress(tables.length);
 *
 *   for (const table of tables) {
 *     yield step();  // { type: "progress", progress: 1, total: 5 }
 *     await copyTable(table, sourceDb, targetDb);
 *   }
 *
 *   return "Migration complete";
 * }
 *
 * @example
 * // Indeterminate progress (no total)
 * function* processQueue({ queueUrl }, ask) {
 *   const step = createProgress();
 *
 *   while (hasMessages(queueUrl)) {
 *     yield step();  // { type: "progress", progress: 1 }
 *     await processMessage(queueUrl);
 *   }
 *
 *   return "Queue processed";
 * }
 */
export function createProgress(total) {
  // Validate total if provided
  if (total !== undefined && (typeof total !== "number" || total <= 0)) {
    throw new Error("createProgress() total must be a positive number if provided");
  }

  let currentStep = 0;

  /**
   * Step function - call to generate next progress notification
   * @returns {Object} Progress notification object
   */
  return function step() {
    currentStep++;

    const notification = {
      type: "progress",
      progress: currentStep,
    };

    // Include total only if provided (determinate progress)
    if (total !== undefined) {
      notification.total = total;
    }

    return notification;
  };
}
