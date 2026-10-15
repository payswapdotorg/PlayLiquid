/** Colocated declaration for desktop-product-identity.mjs (RW-002 identity single source of truth). */

export interface DesktopProductIdentity {
  flavor: "production" | "preview";
  appId: string;
  productName: string;
  linuxExecutableName: string;
  linuxPackageName: string;
  linuxArtifactBaseName: string;
  deepLinkScheme: string;
  linuxDataRootDirName: string;
  updaterCacheDirName: string;
  remoteUpdateFeedEnabled: boolean;
  cuaHelperInstallVariant: string | null;
}

export type DesktopProductFlavor = "production" | "preview";

export const ZCODE_PREVIEW_IDENTITY_ENV: string;

export const desktopProductIdentities: Readonly<
  Record<DesktopProductFlavor, Readonly<DesktopProductIdentity>>
>;

export const desktopApplicationNames: Readonly<{
  development: string;
  preview: string;
  production: string;
}>;

export const desktopDeepLinkSchemes: readonly string[];

export function isPreviewIdentityRequested(env?: NodeJS.ProcessEnv): boolean;
export function resolveDesktopProductFlavor(env?: NodeJS.ProcessEnv): DesktopProductFlavor;
export function resolveDesktopProductIdentity(env?: NodeJS.ProcessEnv): DesktopProductIdentity;
export function resolveDesktopArtifactSuffix(env?: NodeJS.ProcessEnv): string;
export function resolveDesktopLinuxArtifactBaseName(env?: NodeJS.ProcessEnv): string;
export function resolveWindowsAppUserModelIdForFlavor(
  flavor: string,
  runtime?: { isPackaged?: boolean },
): string;
export function resolveWindowsAppUserModelId(
  env?: NodeJS.ProcessEnv,
  runtime?: { isPackaged?: boolean },
): string;
