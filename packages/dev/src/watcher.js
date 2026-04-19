/**
 * @mctx-ai/dev File Watcher
 *
 * Watches project files for changes and triggers hot reload.
 * Uses Node's built-in fs.watch with debouncing to avoid rapid reloads.
 *
 * Watches:
 * - Project root (if package.json found)
 * - Common directories: src/, lib/, utils/ (recursively)
 * - Falls back to entry file directory if no package.json found
 */

import { watch as fsWatch, existsSync } from "fs";
import { dirname, join } from "path";

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  gray: "\x1b[90m",
};

/**
 * Format timestamp for logs
 */
function timestamp() {
  return new Date().toISOString().split("T")[1].split(".")[0];
}

/**
 * Log with timestamp
 */
function log(message) {
  console.log(`${colors.gray}[${timestamp()}]${colors.reset} ${message}`);
}

/**
 * Find project root by walking up to find package.json
 */
function findProjectRoot(startPath) {
  let currentPath = startPath;

  // Walk up until we find package.json or reach root
  while (currentPath !== dirname(currentPath)) {
    const packageJsonPath = join(currentPath, "package.json");
    if (existsSync(packageJsonPath)) {
      return currentPath;
    }
    currentPath = dirname(currentPath);
  }

  return null;
}

/**
 * Get directories to watch
 */
function getWatchDirs(entryFilePath) {
  const entryDir = dirname(entryFilePath);
  const projectRoot = findProjectRoot(entryDir);

  if (!projectRoot) {
    // No package.json found, fall back to entry file directory
    return [{ path: entryDir, recursive: true }];
  }

  const watchDirs = [];

  // Watch common directories recursively if they exist
  const commonDirs = ["src", "lib", "utils"];
  for (const dir of commonDirs) {
    const dirPath = join(projectRoot, dir);
    if (existsSync(dirPath)) {
      watchDirs.push({ path: dirPath, recursive: true });
    }
  }

  // If no common dirs found, watch project root non-recursively
  if (watchDirs.length === 0) {
    watchDirs.push({ path: projectRoot, recursive: false });
  }

  return watchDirs;
}

/**
 * Watch file and directories for changes
 *
 * @param {string} filePath - Absolute path to file to watch
 * @param {Function} onChange - Callback when file changes
 * @returns {Object} Object with watchers array and watchedDirs info
 *
 * Watches project root and common directories (src/, lib/, utils/) recursively.
 * Falls back to entry file directory if no package.json found.
 */
export function watch(filePath, onChange) {
  let debounceTimer = null;
  const DEBOUNCE_MS = 100;

  const watchDirs = getWatchDirs(filePath);
  const watchers = [];

  // Watch each directory
  for (const { path, recursive } of watchDirs) {
    const watcher = fsWatch(path, { recursive }, (eventType, changedFile) => {
      // Only watch .js, .mjs, .cjs, and .json files
      const watchedExtensions = [".js", ".mjs", ".cjs", ".json"];
      if (changedFile && !watchedExtensions.some((ext) => changedFile.endsWith(ext))) {
        return;
      }

      // Debounce rapid changes (editors often write multiple times)
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        log(
          `${colors.green}Reloaded:${colors.reset} ${colors.dim}${changedFile || "file"}${colors.reset}`,
        );
        onChange();
      }, DEBOUNCE_MS);
    });

    // Handle watcher errors
    watcher.on("error", (error) => {
      console.error(`Watcher error: ${error.message}`);
    });

    watchers.push(watcher);
  }

  // Clean up on process exit
  process.on("exit", () => {
    watchers.forEach((w) => w.close());
  });

  return { watchers, watchedDirs: watchDirs };
}
