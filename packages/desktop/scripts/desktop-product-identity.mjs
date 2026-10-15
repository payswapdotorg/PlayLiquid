/**
 * PlayLiquid GameOS 桌面产品身份 —— 唯一事实来源（single source of truth）。
 *
 * electron-builder 配置（appId / productName / executableName / deb 包名 / 协议 / 产物名）、
 * tsup/vite 的构建档位，以及 main 进程里所有需要产品名的表面（应用菜单、托盘、About、
 * 深链 scheme、Electron userData 目录、数据根目录、更新策略）都从这里取值或经由 flavor
 * 间接引用，禁止在别处复制粘贴同一常量。
 *
 * 身份继承自 ZCode fork（3.14.3），但安装身份全面隔离（RW-002）：一个 PlayLiquid GameOS
 * 安装不得冒充或覆盖已有的 ZCode 安装 —— appId、可执行名、deb 包名、桌面协议、
 * Electron profile/userData、数据根目录、更新通道全部不同。
 */

/**
 * 构建期开关：为真时安装包使用 Preview 身份，而后端环境仍由 `ZCODE_ENV` 单独决定。
 * 典型用法是 `ZCODE_ENV=production ZCODE_PREVIEW_IDENTITY=1`，得到一个连接生产后端、
 * 可与正式版并排安装的 `PlayLiquid GameOS Preview`。
 */
export const ZCODE_PREVIEW_IDENTITY_ENV = "ZCODE_PREVIEW_IDENTITY";

/**
 * PlayLiquid GameOS 正式身份。
 *
 * - `appId`：反向域名 `org.playliquid.gameos`（ZCode 正式版是 `dev.zcode.app`）。
 * - `productName`：展示名 + 默认窗口标题 + Electron app.name。
 * - `linuxExecutableName`：Linux 可执行与 hicolor 图标名（`/usr/bin/playliquid-gameos`，
 *   ZCode 是 `zcode`）。
 * - `linuxPackageName`：deb/rpm/pacman 包名（`playliquid-gameos`，ZCode 是 `zcode`），
 *   dpkg/dnf/pacman 不会把两个产品当作同一包互相升级覆盖。
 * - `linuxArtifactBaseName`：产物文件名基名（无空格，避免下载/校验脚本转义问题）。
 * - `deepLinkScheme`：本产品注册的桌面协议（`playliquid://`，ZCode 是 `zcode://`）。
 * - `linuxDataRootDirName`：主进程默认数据根目录名（`~/.playliquid-gameos`，ZCode 数据在
 *   `~/.zcode`），services 层的 `.zcode` 内部布局保持不变（fork 内部命名，非用户可见）。
 * - `remoteUpdateFeedEnabled`：远端更新源开关。当前唯一已知的更新 manifest 服务是
 *   ZCode/Z.AI 后端，它只分发 ZCode 安装包；对 PlayLiquid 安装应用该 feed 会把产品静默
 *   替换成 ZCode —— 这正是 RW-002 明令禁止的行为。因此在 PlayLiquid 专属更新源存在
 *   之前，自动更新与远端强制升级 gate 必须关闭（OAuth 登录轮询不受影响）。
 */
const PRODUCTION_IDENTITY = Object.freeze({
  flavor: "production",
  appId: "org.playliquid.gameos",
  productName: "PlayLiquid GameOS",
  linuxExecutableName: "playliquid-gameos",
  linuxPackageName: "playliquid-gameos",
  linuxArtifactBaseName: "PlayLiquid-GameOS",
  deepLinkScheme: "playliquid",
  linuxDataRootDirName: ".playliquid-gameos",
  updaterCacheDirName: "playliquid-gameos-updater",
  remoteUpdateFeedEnabled: false,
  cuaHelperInstallVariant: null,
});

/**
 * Preview 身份：测试后端构建（`ZCODE_ENV=test`）或显式 `ZCODE_PREVIEW_IDENTITY=1` 的
 * 生产后端构建。与正式版保持并排安装所需的全套隔离（appId/可执行/包名/数据根）。
 */
const PREVIEW_IDENTITY = Object.freeze({
  flavor: "preview",
  appId: "org.playliquid.gameos.preview",
  productName: "PlayLiquid GameOS Preview",
  linuxExecutableName: "playliquid-gameos-preview",
  linuxPackageName: "playliquid-gameos-preview",
  linuxArtifactBaseName: "PlayLiquid-GameOS-Preview",
  deepLinkScheme: "playliquid-preview",
  // 与上游 ZCode Preview 同语义：Preview 与正式版共享任务、配置和凭据（数据根同名），
  // 安装隔离由 appId/可执行/包名承担。
  linuxDataRootDirName: ".playliquid-gameos",
  updaterCacheDirName: "playliquid-gameos-preview-updater",
  remoteUpdateFeedEnabled: false,
  cuaHelperInstallVariant: "preview",
});

export const desktopProductIdentities = Object.freeze({
  production: PRODUCTION_IDENTITY,
  preview: PREVIEW_IDENTITY,
});

/**
 * Electron app.name（未打包 dev / 打包 preview / 打包 production 三态）。
 * 该名字决定默认窗口标题、应用菜单首项、`~/.config/<name>` userData 目录与
 * Electron 单实例锁的归属 —— PlayLiquid 的 profile 与 ZCode（`~/.config/ZCode`）
 * 天然隔离。
 */
export const desktopApplicationNames = Object.freeze({
  development: "PlayLiquid GameOS Dev",
  preview: "PlayLiquid GameOS Preview",
  production: "PlayLiquid GameOS",
});

/**
 * 深链协议解析白名单：本产品注册的 scheme（当前 flavor 的 `deepLinkScheme`）之外，
 * 继续解析 fork 上游的 `zcode` 协议（只解析、绝不注册）。原因：
 * - services/web 共享层的 OAuth 官网中转页与分享链接仍回跳 `zcode://`；
 * - OAuth 登录本身由 Host 轮询兜底（deep link 丢失不影响完成授权）；
 * - 若用户手工把 `zcode://` 指到 PlayLiquid，分享导入等链接可以继续工作。
 * PlayLiquid 自己只注册 `deepLinkScheme`，不会抢占 ZCode 的协议处理器。
 */
export const desktopDeepLinkSchemes = Object.freeze(["playliquid", "playliquid-preview", "zcode"]);

function normalizeDesktopZCodeEnv(env) {
  return env.ZCODE_ENV?.trim().toLowerCase() === "production" ? "production" : "test";
}

/**
 * 开关只有一种开启拼写 `1`（`0` / 空 = 关闭），与 CI workflow 规则和 release 门的
 * `$ZCODE_PREVIEW_IDENTITY == "1"` 精确比较保持同一套语义。其它拼写在构建期直接失败，
 * 避免 `true` 之类在 YAML 路由层漏匹配、却在脚本层被当成开启，把 Preview 包打进生产验收目录。
 */
export function isPreviewIdentityRequested(env = process.env) {
  const value = env[ZCODE_PREVIEW_IDENTITY_ENV]?.trim() ?? "";
  if (value === "1") {
    return true;
  }
  if (value === "" || value === "0") {
    return false;
  }
  throw new Error(
    `invalid ${ZCODE_PREVIEW_IDENTITY_ENV}=${env[ZCODE_PREVIEW_IDENTITY_ENV]}; expected 1 or 0`,
  );
}

/**
 * 产品身份（flavor）与后端环境（`ZCODE_ENV`）是两个轴：
 * - `ZCODE_ENV=test` 一律是 Preview，测试后端不能顶着正式产品身份覆盖用户的正式安装；
 * - `ZCODE_ENV=production` 默认是正式身份，显式 `ZCODE_PREVIEW_IDENTITY=1` 时改用 Preview 身份。
 * 未知 `ZCODE_ENV` 继续按 test 处理，和共享层 normalizeZCodeEnv 的 fail-safe 默认值一致。
 */
export function resolveDesktopProductFlavor(env = process.env) {
  if (isPreviewIdentityRequested(env)) {
    return "preview";
  }
  return normalizeDesktopZCodeEnv(env) === "production" ? "production" : "preview";
}

export function resolveDesktopProductIdentity(env = process.env) {
  return desktopProductIdentities[resolveDesktopProductFlavor(env)];
}

/**
 * 产物文件名后缀标记的是后端环境而不是身份：`_TEST` 只出现在测试后端的安装包上。
 * 生产后端的 Preview 包靠 linuxArtifactBaseName / productName 与正式包区分。
 */
export function resolveDesktopArtifactSuffix(env = process.env) {
  return normalizeDesktopZCodeEnv(env) === "test" ? "_TEST" : "";
}

/** 供 main 进程与打包配置使用的 Linux 产物名基名（见 identity 字段说明）。 */
export function resolveDesktopLinuxArtifactBaseName(env = process.env) {
  return resolveDesktopProductIdentity(env).linuxArtifactBaseName;
}

/**
 * 返回 Windows Shell 使用的 AppUserModelId。
 *
 * 打包态必须复用 electron-builder 的 appId，否则快捷方式里的 AUMID、开始菜单索引
 * 和运行中的 Electron 进程会被 Windows 视为三个不同的应用。开发态使用 PlayLiquid
 * 的专属 dev AUMID（不沿用 fork 上游的 `cn.aminer.zcode`），继续避免本地调试快捷
 * 方式和正式/Preview 安装包互相污染。
 */
export function resolveWindowsAppUserModelIdForFlavor(flavor, runtime = { isPackaged: true }) {
  if (runtime.isPackaged === false) {
    return "org.playliquid.gameos.dev";
  }
  return desktopProductIdentities[flavor === "preview" ? "preview" : "production"].appId;
}

export function resolveWindowsAppUserModelId(env = process.env, runtime = { isPackaged: true }) {
  return resolveWindowsAppUserModelIdForFlavor(resolveDesktopProductFlavor(env), runtime);
}
