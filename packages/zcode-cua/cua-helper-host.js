import { CuaHelperError, callBrokerMethod, probeHelperHealth } from "./broker.js";
import {
  DEV_CUA_HELPER_BUNDLE_ID,
  HELPER_BUNDLE_ID,
} from "./broker-helper-constants.js";
import {
  HELPER_ADDON_ENV,
  isCuaLocalDevelopmentRuntime,
} from "./cua-helper-identity.js";
import { createCuaHelperInstaller } from "./cua-helper-installer.js";

export class CuaHelperLifecycleManager {
  #dispose;
  #current;
  #disposed = false;
  constructor(dispose) {
    this.#dispose = dispose;
    this.#current = undefined;
  }
  async acquire(options) {
    if (this.#disposed) return undefined;
    if (typeof options?.isAdmitted === "function" && !options.isAdmitted()) {
      return undefined;
    }
    if (
      this.#current &&
      typeof options?.shouldRetainCurrent === "function" &&
      options.shouldRetainCurrent(this.#current)
    ) {
      return this.#current;
    }
    const previous = this.#current;
    const managed = options?.create?.();
    this.#current = managed;
    if (previous && previous !== managed) {
      await this.#dispose?.(previous);
    }
    return managed;
  }
  peek() {
    return this.#current;
  }
  get disposed() {
    return this.#disposed;
  }
  async dispose(managed) {
    this.#disposed = true;
    await this.#dispose?.(managed ?? this.#current);
    this.#current = undefined;
  }
}

export class CuaProductHelperWorkspaceRegistry {
  #enabled = new Set();
  setEnabled(context, enabled) {
    const key = context?.workspaceIdentity?.trim() || context?.workspacePath?.trim() || "";
    if (!key) return;
    if (enabled) this.#enabled.add(key);
    else this.#enabled.delete(key);
  }
  isEnabled(context) {
    const key = context?.workspaceIdentity?.trim() || context?.workspacePath?.trim() || "";
    return this.#enabled.has(key);
  }
}

export async function waitForCuaHelperStartup(startup, deadlineMs = 10_000) {
  let timer;
  try {
    return await Promise.race([
      startup,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new CuaHelperError(
              `ZCode Computer Use is still starting after ${deadlineMs}ms; retry the task shortly`,
              { code: "caller_timeout" },
            ),
          );
        }, deadlineMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isPotentialZCodeCuaAgentMcpServer(server) {
  if (!server || typeof server !== "object") return false;
  const name = typeof server.name === "string" ? server.name.toLowerCase() : "";
  const command = typeof server.command === "string" ? server.command.toLowerCase() : "";
  return name.includes("cua") || name.includes("computer-use") || command.includes("cua");
}

export function isScreenCaptureProbeSuccess(probe) {
  return Boolean(probe) && typeof probe === "object" && probe.ok === true;
}

export function isOfficialCuaPluginEnabledForWorkspace(options = {}) {
  const env = options.env ?? process.env;
  if (env.ZCODE_CUA_DISABLED === "1") return false;
  if (env.ZCODE_CUA_ENABLED === "1") return true;
  // 未显式配置时按运行时是否能拿到 helper 判定；这里只做静态开关，
  // 真实可用性由 host 的 health probe 决定。
  return isCuaLocalDevelopmentRuntime(env) || Boolean(env[HELPER_ADDON_ENV]);
}

const AGENT_ENV_UNAVAILABLE = Symbol.for("zcode.cua/agent-env-unavailable");

function recoveryStateFor(host) {
  const target = host ?? {};
  if (!target[AGENT_ENV_UNAVAILABLE]) {
    target[AGENT_ENV_UNAVAILABLE] = { generation: 0, pendingGeneration: null };
  }
  return target[AGENT_ENV_UNAVAILABLE];
}

export function markCuaProductHelperAgentEnvUnavailable(host) {
  const state = recoveryStateFor(host);
  state.generation += 1;
  state.pendingGeneration = state.generation;
  return state.generation;
}

export function hasCuaProductHelperAgentEnvUnavailable(host) {
  return recoveryStateFor(host).pendingGeneration !== null;
}

export function clearCuaProductHelperAgentEnvUnavailable(host) {
  recoveryStateFor(host).pendingGeneration = null;
}

export async function requestHelperAccessibilityPermissionViaLaunchServices() {
  // macOS：打系统设置的「辅助功能」面板。Windows/Linux 无对应概念。
  if (process.platform !== "darwin") {
    return { ok: false, reason: "accessibility permission is only managed on macOS" };
  }
  return { ok: true, reason: "open System Settings > Privacy & Security > Accessibility" };
}

export async function requestHelperScreenRecordingPermissionViaLaunchServices() {
  if (process.platform !== "darwin") {
    return { ok: false, reason: "screen recording permission is only managed on macOS" };
  }
  return { ok: true, reason: "open System Settings > Privacy & Security > Screen Recording" };
}

export function createProductCuaHelperHost(options = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger;
  const healthTimeoutMs = options.healthTimeoutMs ?? 5_000;
  const installer =
    options.helperInstaller === false
      ? undefined
      : options.helperInstaller ??
        createCuaHelperInstaller({ logger, env, bundledAppPath: options.bundledHelperAppPath });

  let handle = null;
  let socketPath = null;
  let startInFlight = null;

  const buildHandle = (path) => ({
    socketPath: path,
    launchSocketPath: path,
    pluginAuthority: "zcode-cua-product",
    bundleId: isCuaLocalDevelopmentRuntime(env) ? DEV_CUA_HELPER_BUNDLE_ID : HELPER_BUNDLE_ID,
  });

  const start = async () => {
    if (handle) return handle;
    if (startInFlight) return await startInFlight;
    startInFlight = (async () => {
      if (installer) await installer.ensureInstalled();
      // helper 由上层 launcher 拉起（桌面侧 spawn + --socket/--parent-pid）；
      // 这里只负责登记 socket 并探活，避免在 SDK 层重复实现进程管理。
      const path = env[HELPER_ADDON_ENV]?.endsWith(".sock")
        ? env[HELPER_ADDON_ENV]
        : options.socketPath;
      if (typeof path !== "string" || !path.trim()) {
        throw new CuaHelperError(
          "Computer Use helper socket path is unknown; the desktop launcher must pass it in",
          { code: "helper_unavailable" },
        );
      }
      socketPath = path.trim();
      handle = buildHandle(socketPath);
      return handle;
    })().finally(() => {
      startInFlight = null;
    });
    return await startInFlight;
  };

  return {
    get running() {
      return handle !== null;
    },
    get socketPath() {
      return socketPath;
    },
    get pluginAuthority() {
      return handle?.pluginAuthority ?? null;
    },
    get reservedTransport() {
      return handle
        ? { socketPath: handle.socketPath, pluginAuthority: handle.pluginAuthority }
        : undefined;
    },
    start,
    async stop() {
      handle = null;
      socketPath = null;
    },
    async restart() {
      await this.stop();
      return await start();
    },
    async restartAfterCurrentStart() {
      return await this.restart();
    },
    async waitForTransport(timeoutMs = healthTimeoutMs) {
      const current = await start();
      const health = await probeHelperHealth(current.socketPath, { timeoutMs });
      if (!health.bundleId && !health.pid) {
        throw new CuaHelperError("Computer Use helper did not answer the health probe", {
          code: "helper_unavailable",
        });
      }
      return { socketPath: current.socketPath, pluginAuthority: current.pluginAuthority };
    },
    async checkHealth(timeoutMs = healthTimeoutMs) {
      const current = await start();
      return await probeHelperHealth(current.socketPath, { timeoutMs });
    },
    async queryScreenCaptureProbe() {
      try {
        const current = await start();
        const result = await callBrokerMethod({
          socketPath: current.socketPath,
          method: "query_screen_capture_probe",
          timeoutMs: 3_000,
        });
        return { ok: result?.ok === true };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
    async queryScreenRecordingPreflight() {
      try {
        const report = await this.queryPermissionStatus();
        return report?.screen_recording;
      } catch {
        return undefined;
      }
    },
    async queryPermissionStatus() {
      const current = await start();
      return await callBrokerMethod({
        socketPath: current.socketPath,
        method: "query_permission_status",
        timeoutMs: 5_000,
      });
    },
  };
}

/**
 * 把 Computer Use 的 MCP server 配置解析成可启动形态。
 *
 * 补齐原因：开源版恒 `resolveMcpServers` 原样返回且 restart 抛 unavailable，
 * 导致 node-repl-host 拿不到 CUA broker 的 transport，Computer Use 工具面挂不上。
 */
export function createCuaProductMcpServerResolver(host, options = {}) {
  const hasActiveTurn = options.hasActiveTurn ?? (() => false);
  return {
    async resolveMcpServers(servers, context) {
      if (!Array.isArray(servers)) return servers;
      const registry = new CuaProductHelperWorkspaceRegistry();
      if (context) registry.setEnabled(context, true);
      // 只给 ZCode 自家 CUA agent server 注入 transport；其它 server 原样透传。
      return await Promise.all(
        servers.map(async (server) => {
          if (!isPotentialZCodeCuaAgentMcpServer(server)) return server;
          try {
            const transport = await host.waitForTransport?.();
            return {
              ...server,
              env: {
                ...server?.env,
                ...(transport?.socketPath
                  ? { ZCODE_CUA_PERMISSION_BROKER_SOCKET: transport.socketPath }
                  : {}),
                ...(transport?.pluginAuthority
                  ? { ZCODE_CUA_PERMISSION_BROKER_AUTHORITY: transport.pluginAuthority }
                  : {}),
              },
            };
          } catch {
            // transport 尚未就绪时不能把 server 整个丢掉：留原样，下一次 resolve 再注入。
            return server;
          }
        }),
      );
    },
    async restart() {
      if (hasActiveTurn()) {
        throw new CuaHelperError("cannot restart the Computer Use helper while a turn is active", {
          code: "busy",
        });
      }
      await host.restart();
    },
    async restartAfterPermissionGrant() {
      await host.restart();
    },
  };
}
