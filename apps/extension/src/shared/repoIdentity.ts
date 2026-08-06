/**
 * 仓库与维护者身份的唯一来源。
 *
 * 运行时 GitHub 端点必须由这些常量推导，避免后续迁移仓库时再次分散修改 URL。
 */
export const REPO_OWNER = 'JavdBviewed';
export const REPO_NAME = 'JavdBviewed';
export const REPO_SLUG = `${REPO_OWNER}/${REPO_NAME}`;
export const RELEASE_REPO_NAME = 'JavdBviewed-release';
export const RELEASE_REPO_SLUG = `${REPO_OWNER}/${RELEASE_REPO_NAME}`;

export const REPO_URL = `https://github.com/${REPO_SLUG}`;
export const REPO_RELEASES_URL = `https://github.com/${RELEASE_REPO_SLUG}/releases`;
export const REPO_RELEASES_LATEST_URL = `${REPO_RELEASES_URL}/latest`;
export const REPO_ISSUES_URL = `${REPO_URL}/issues`;
export const REPO_API_RELEASES_URL = `https://api.github.com/repos/${RELEASE_REPO_SLUG}/releases`;
export const REPO_RAW_PREFIX = `https://raw.githubusercontent.com/${REPO_SLUG}`;
export const REPO_JSDELIVR_PACKAGE_URL = `https://data.jsdelivr.com/v1/packages/gh/${REPO_SLUG}`;

export const AUTHOR_NAME = REPO_OWNER;
export const AUTHOR_PROFILE_URL = `https://github.com/${AUTHOR_NAME}`;

export function getRepoRawUrl(path: string, ref = 'main'): string {
  const normalizedPath = path.replace(/^\/+/, '');
  return `${REPO_RAW_PREFIX}/${ref}/${normalizedPath}`;
}
