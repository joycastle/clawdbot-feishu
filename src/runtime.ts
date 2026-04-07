import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setFeishuRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getFeishuRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Feishu runtime not initialized");
  }
  return runtime;
}

/**
 * Get the Feishu runtime if available, or null if not initialized.
 * Useful for CLI contexts where the plugin runtime may not be loaded.
 */
export function tryGetFeishuRuntime(): PluginRuntime | null {
  return runtime;
}
