import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setDataBaseDir } from "@zcode/services/node";
import { desktopProductIdentities } from "../../scripts/desktop-product-identity.mjs";

/**
 * RW-002 数据根隔离：PlayLiquid GameOS 的 services 层数据（凭据、日志、任务索引、
 * 默认会话工作区、telemetry 状态等）默认落在 `~/.playliquid-gameos/.zcode/**`，
 * 与 ZCode 安装的数据根 `~/.zcode/**` 完全分离，避免任一产品的「清除所有数据」
 * 或后台写入破坏另一个产品的数据。
 *
 * services 是只读面且其路径规则固定为 `join(dataBaseDir, ".zcode")`，因此这里用两条
 * 已有通道完成重定向（不新增第二套路径权威）：
 * - `setDataBaseDir()`：paths.ts 家族（getAppConfigDir/getZCodeDataRootDir/...）；
 * - `process.env.ZCODE_DESKTOP_HOME_DIR`：settingService 的 settings 目录锚点
 *   （`<home>/.zcode/v2/setting.json`）。注意：Electron 的 app home 不能跟着搬 ——
 *   desktopRuntimeEnv 会识别出这个「产品注入值」并继续使用真实用户 home，
 *   XDG 桌面条目/图标注册因此不受影响。
 *
 * 优先级（与既有语义保持一致）：
 * 1. setting.json 里的 `dataBaseDir`（用户自定义数据目录，最高）；
 * 2. 启动前已存在的 `ZCODE_DESKTOP_HOME_DIR`（e2e / 独立桌面 dev 实例，以其为根）；
 * 3. PlayLiquid GameOS 产品数据根 `~/.playliquid-gameos`。
 */
export const DESKTOP_PRODUCT_DATA_ROOT_DIR_NAME =
  desktopProductIdentities.production.linuxDataRootDirName;

/** 产品默认数据根：`~/<identity.linuxDataRootDirName>`（prod/preview 同根，镜像上游共享语义）。 */
export function resolveDesktopProductDataRootDir(): string {
  return join(homedir(), DESKTOP_PRODUCT_DATA_ROOT_DIR_NAME);
}

/**
 * 解析本进程的数据根锚点。e2e/dev 实例显式设置的 ZCODE_DESKTOP_HOME_DIR 保持原语义。
 */
export function resolveDesktopDataRootDir(): string {
  const explicitHome = process.env.ZCODE_DESKTOP_HOME_DIR?.trim();
  return explicitHome && explicitHome.length > 0 ? explicitHome : resolveDesktopProductDataRootDir();
}

function resolveBootstrapSettingsFile(dataRootDir: string = resolveDesktopDataRootDir()): string {
  return join(dataRootDir, ".zcode", "v2", "setting.json");
}

function extractBootstrapDataBaseDir(rawValue: unknown): string | null {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const dataBaseDir = (rawValue as { dataBaseDir?: unknown }).dataBaseDir;
  if (typeof dataBaseDir !== "string") {
    return null;
  }

  const trimmed = dataBaseDir.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBootstrapDataBaseDirFromDisk(
  settingsFile: string = resolveBootstrapSettingsFile(),
): string | null {
  if (!existsSync(settingsFile)) {
    return null;
  }

  try {
    const raw = readFileSync(settingsFile, "utf-8");
    return extractBootstrapDataBaseDir(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function applyEarlyDataBaseDirBootstrap(): string | null {
  const dataRootDir = resolveDesktopDataRootDir();
  const dataBaseDir = readBootstrapDataBaseDirFromDisk(resolveBootstrapSettingsFile(dataRootDir));
  if (dataBaseDir) {
    // 用户自定义数据目录：setting.json 与数据目录允许分属两个根（上游既有语义）。
    setDataBaseDir(dataBaseDir);
  } else {
    setDataBaseDir(dataRootDir);
  }

  // settings 目录锚点只在产品默认根生效时注入（e2e/dev 已有自己的 ZCODE_DESKTOP_HOME_DIR）。
  // desktopRuntimeEnv 会把这个值识别为「产品注入」而不迁移 Electron app home。
  const explicitHome = process.env.ZCODE_DESKTOP_HOME_DIR?.trim();
  if (!explicitHome || explicitHome.length === 0) {
    process.env.ZCODE_DESKTOP_HOME_DIR = dataRootDir;
  }
  return dataBaseDir;
}
