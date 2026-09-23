/**
 * `@zcode/zcode-cua/broker/server` 入口。
 *
 * 按 `broker-server.d.ts` 的导出面分组拆到同目录模块，本文件只做转发：
 *   - cua-helper-identity.js   启动 argv / 权限主体 / 本地开发判定
 *   - cua-helper-installer.js  安装校验 / 原生 addon 加载 / refresh marker
 *   - cua-ax-roles.js          AX role→kind 映射与只读方法集
 *   - cua-helper-host.js       helper 宿主生命周期 / MCP resolver
 *
 * 拆分原因：oxlint `max-lines` 对生产代码限 400 行（跳过空行与注释），
 * 单文件实现 28 个契约导出会超限。
 */
export {
  HELPER_ADDON_ENV,
  WINDOWS_DEV_CONTROL_PROTOCOL,
  buildHelperOpenArgs,
  isCuaLocalDevelopmentRuntime,
  resolveHelperPermissionSubjectIdentity,
} from "./cua-helper-identity.js";

export {
  createCuaHelperInstaller,
  defaultCuaHelperVerifierDependencies,
  cuaBrokerRefreshMarkerPath,
  publishCuaBrokerRefreshMarker,
  loadRealNativeAddon,
  resolvePackagedNativeAddonPath,
  resolveInTreeAddonPath,
  reapOrphanedHelpers,
} from "./cua-helper-installer.js";

export { ROLE_TO_KIND, roleToKind, createAxReadOnlyMethods } from "./cua-ax-roles.js";

export {
  CuaHelperLifecycleManager,
  CuaProductHelperWorkspaceRegistry,
  createProductCuaHelperHost,
  createCuaProductMcpServerResolver,
  isOfficialCuaPluginEnabledForWorkspace,
  waitForCuaHelperStartup,
  isPotentialZCodeCuaAgentMcpServer,
  isScreenCaptureProbeSuccess,
  markCuaProductHelperAgentEnvUnavailable,
  hasCuaProductHelperAgentEnvUnavailable,
  clearCuaProductHelperAgentEnvUnavailable,
  requestHelperAccessibilityPermissionViaLaunchServices,
  requestHelperScreenRecordingPermissionViaLaunchServices,
} from "./cua-helper-host.js";

export { HELPER_APP_NAME, DEV_HELPER_APP_NAME } from "./broker-helper-constants.js";
