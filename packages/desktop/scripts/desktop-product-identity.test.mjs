/**
 * RW-002 身份单元测试 —— `node --test packages/desktop/scripts/desktop-product-identity.test.mjs`
 *
 * 断言 PlayLiquid GameOS 身份的内部一致性，以及与 fork 上游 ZCode 身份的全面隔离
 * （appId / 可执行名 / deb 包名 / 深链协议 / 数据根 / 更新缓存 —— 任一相同都会让
 * 一个 PlayLiquid 安装覆盖或冒充已有的 ZCode 安装）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ZCODE_PREVIEW_IDENTITY_ENV,
  desktopApplicationNames,
  desktopDeepLinkSchemes,
  desktopProductIdentities,
  isPreviewIdentityRequested,
  resolveDesktopArtifactSuffix,
  resolveDesktopLinuxArtifactBaseName,
  resolveDesktopProductFlavor,
  resolveDesktopProductIdentity,
  resolveWindowsAppUserModelId,
  resolveWindowsAppUserModelIdForFlavor,
} from "./desktop-product-identity.mjs";

// fork 上游（ZCode 3.14.3）的安装身份 —— RW-002 的隔离基准。
const ZCODE_UPSTREAM_IDENTITY = Object.freeze({
  appId: "dev.zcode.app",
  previewAppId: "dev.zcode.app.preview",
  productName: "ZCode",
  previewProductName: "ZCode Preview",
  linuxExecutableName: "zcode",
  previewLinuxExecutableName: "zcode-preview",
  linuxPackageName: "zcode",
  deepLinkScheme: "zcode",
  dataRootDirName: ".zcode",
});

const PRODUCTION = desktopProductIdentities.production;
const PREVIEW = desktopProductIdentities.preview;

test("production and preview identities stay internally consistent", () => {
  for (const identity of [PRODUCTION, PREVIEW]) {
    assert.equal(typeof identity.appId, "string");
    assert.ok(identity.appId.length > 0);
    assert.ok(identity.productName.length > 0);
    assert.ok(identity.linuxExecutableName.length > 0);
    assert.ok(identity.linuxPackageName.length > 0);
    assert.ok(identity.linuxArtifactBaseName.length > 0);
    assert.ok(identity.deepLinkScheme.length > 0);
    assert.ok(identity.linuxDataRootDirName.startsWith("."));
    assert.ok(identity.updaterCacheDirName.length > 0);
    assert.equal(typeof identity.remoteUpdateFeedEnabled, "boolean");
    // Debian 包名/可执行名规范：小写字母数字与连字符，无空格。
    assert.match(identity.linuxExecutableName, /^[a-z0-9][a-z0-9-]*$/);
    assert.match(identity.linuxPackageName, /^[a-z0-9][a-z0-9-]*$/);
    // 产物基名不允许空格：下载链接、sha256sum 与 shell 工具链不转义空格。
    assert.doesNotMatch(identity.linuxArtifactBaseName, /\s/);
    assert.doesNotMatch(identity.productName, /\s$/);
    // appId 反向域名规范。
    assert.match(identity.appId, /^[a-z0-9.-]+$/);
    // 协议 scheme 规范字符。
    assert.match(identity.deepLinkScheme, /^[a-z][a-z0-9+.-]*$/);
  }
  assert.equal(PRODUCTION.flavor, "production");
  assert.equal(PREVIEW.flavor, "preview");
});

test("PlayLiquid identities are fully distinct from the ZCode upstream identity", () => {
  for (const identity of [PRODUCTION, PREVIEW]) {
    assert.notEqual(identity.appId, ZCODE_UPSTREAM_IDENTITY.appId);
    assert.notEqual(identity.appId, ZCODE_UPSTREAM_IDENTITY.previewAppId);
    assert.notEqual(identity.productName, ZCODE_UPSTREAM_IDENTITY.productName);
    assert.notEqual(identity.productName, ZCODE_UPSTREAM_IDENTITY.previewProductName);
    assert.notEqual(identity.linuxExecutableName, ZCODE_UPSTREAM_IDENTITY.linuxExecutableName);
    assert.notEqual(
      identity.linuxExecutableName,
      ZCODE_UPSTREAM_IDENTITY.previewLinuxExecutableName,
    );
    assert.notEqual(identity.linuxPackageName, ZCODE_UPSTREAM_IDENTITY.linuxPackageName);
    assert.notEqual(identity.deepLinkScheme, ZCODE_UPSTREAM_IDENTITY.deepLinkScheme);
    assert.notEqual(identity.linuxDataRootDirName, ZCODE_UPSTREAM_IDENTITY.dataRootDirName);
  }
});

test("production and preview flavors remain parallel-installable", () => {
  assert.notEqual(PRODUCTION.appId, PREVIEW.appId);
  assert.notEqual(PRODUCTION.productName, PREVIEW.productName);
  assert.notEqual(PRODUCTION.linuxExecutableName, PREVIEW.linuxExecutableName);
  assert.notEqual(PRODUCTION.linuxPackageName, PREVIEW.linuxPackageName);
  // 数据根共享（镜像上游「Preview 与正式版共享任务、配置和凭据」语义），
  // 但两个 flavor 的根都与 ZCode 的 ~/.zcode 隔离（见上一条 test）。
  assert.equal(PRODUCTION.linuxDataRootDirName, PREVIEW.linuxDataRootDirName);
});

test("application names carry the PlayLiquid GameOS product identity", () => {
  for (const name of Object.values(desktopApplicationNames)) {
    assert.ok(name.startsWith("PlayLiquid GameOS"), name);
  }
  // Electron userData / 单实例锁按 app.name 隔离；不能与 ZCode 的任何运行名相同。
  assert.notEqual(desktopApplicationNames.production, "ZCode");
  assert.notEqual(desktopApplicationNames.preview, "ZCode Preview");
  assert.notEqual(desktopApplicationNames.development, "ZCode Dev");
  // production 打包名必须与 electron-builder productName 一致（窗口标题/菜单/桌面条目同源）。
  assert.equal(desktopApplicationNames.production, PRODUCTION.productName);
  assert.equal(desktopApplicationNames.preview, PREVIEW.productName);
});

test("deep link scheme handling keeps the fork compat scheme parseable but never registered", () => {
  for (const identity of [PRODUCTION, PREVIEW]) {
    assert.ok(desktopDeepLinkSchemes.includes(identity.deepLinkScheme));
  }
  assert.ok(desktopDeepLinkSchemes.includes("zcode"));
});

test("remote update feed stays disabled until a PlayLiquid-owned feed exists", () => {
  // ZCode/Z.AI 的更新 manifest 只分发 ZCode 安装包；对 PlayLiquid 应用会静默替换产品。
  assert.equal(PRODUCTION.remoteUpdateFeedEnabled, false);
  assert.equal(PREVIEW.remoteUpdateFeedEnabled, false);
});

test("resolveDesktopProductFlavor keeps the flavor/backend two-axis semantics", () => {
  assert.equal(resolveDesktopProductFlavor({ ZCODE_ENV: "production" }), "production");
  assert.equal(resolveDesktopProductFlavor({ ZCODE_ENV: "test" }), "preview");
  assert.equal(resolveDesktopProductFlavor({}), "preview");
  assert.equal(
    resolveDesktopProductFlavor({ ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "1" }),
    "preview",
  );
  assert.throws(
    () => resolveDesktopProductFlavor({ ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "true" }),
    /invalid ZCODE_PREVIEW_IDENTITY/,
  );
});

test("isPreviewIdentityRequested accepts only the exact CI spellings", () => {
  assert.equal(isPreviewIdentityRequested({}), false);
  assert.equal(isPreviewIdentityRequested({ [ZCODE_PREVIEW_IDENTITY_ENV]: "" }), false);
  assert.equal(isPreviewIdentityRequested({ [ZCODE_PREVIEW_IDENTITY_ENV]: "0" }), false);
  assert.equal(isPreviewIdentityRequested({ [ZCODE_PREVIEW_IDENTITY_ENV]: "1" }), true);
  assert.throws(() => isPreviewIdentityRequested({ [ZCODE_PREVIEW_IDENTITY_ENV]: "true" }));
});

test("resolveDesktopProductIdentity maps flavors to the frozen tables", () => {
  assert.equal(resolveDesktopProductIdentity({ ZCODE_ENV: "production" }), PRODUCTION);
  assert.equal(resolveDesktopProductIdentity({ ZCODE_ENV: "test" }), PREVIEW);
  assert.equal(resolveDesktopProductIdentity({}), PREVIEW);
});

test("artifact suffix marks backend environment, not identity", () => {
  assert.equal(resolveDesktopArtifactSuffix({ ZCODE_ENV: "production" }), "");
  assert.equal(resolveDesktopArtifactSuffix({ ZCODE_ENV: "test" }), "_TEST");
  assert.equal(resolveDesktopArtifactSuffix({}), "_TEST");
});

test("Linux artifact base names match the identity tables", () => {
  assert.equal(resolveDesktopLinuxArtifactBaseName({ ZCODE_ENV: "production" }), "PlayLiquid-GameOS");
  assert.equal(resolveDesktopLinuxArtifactBaseName({ ZCODE_ENV: "test" }), "PlayLiquid-GameOS-Preview");
  assert.notEqual(resolveDesktopLinuxArtifactBaseName({ ZCODE_ENV: "production" }), "ZCode");
});

test("Windows AppUserModelId follows flavor and stays isolated in dev", () => {
  assert.equal(resolveWindowsAppUserModelIdForFlavor("production"), PRODUCTION.appId);
  assert.equal(resolveWindowsAppUserModelIdForFlavor("preview"), PREVIEW.appId);
  // 未知 flavor 一律回落 production，防止空值写进 Shell 注册表。
  assert.equal(resolveWindowsAppUserModelIdForFlavor("unknown"), PRODUCTION.appId);
  // dev AUMID 不得再借用 fork 上游身份，也不得与任一打包身份相同。
  const devAumid = resolveWindowsAppUserModelIdForFlavor("production", { isPackaged: false });
  assert.equal(devAumid, "org.playliquid.gameos.dev");
  assert.notEqual(devAumid, "cn.aminer.zcode");
  assert.notEqual(devAumid, PRODUCTION.appId);
  assert.equal(
    resolveWindowsAppUserModelId({ ZCODE_ENV: "production" }),
    PRODUCTION.appId,
  );
});
