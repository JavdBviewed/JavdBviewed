import { describe, expect, it } from 'vitest';
import {
  AUTHOR_NAME,
  AUTHOR_PROFILE_URL,
  REPO_API_RELEASES_URL,
  REPO_ISSUES_URL,
  REPO_JSDELIVR_PACKAGE_URL,
  REPO_NAME,
  REPO_OWNER,
  REPO_RAW_PREFIX,
  REPO_RELEASES_LATEST_URL,
  REPO_RELEASES_URL,
  REPO_SLUG,
  REPO_URL,
  getRepoRawUrl,
} from './repoIdentity';

describe('repository identity', () => {
  it('derives every GitHub repository endpoint from the migrated owner and repository', () => {
    expect(REPO_OWNER).toBe('JavdBviewed');
    expect(REPO_NAME).toBe('JavdBviewed');
    expect(REPO_SLUG).toBe('JavdBviewed/JavdBviewed');
    expect(REPO_URL).toBe('https://github.com/JavdBviewed/JavdBviewed');
    expect(REPO_RELEASES_URL).toBe('https://github.com/JavdBviewed/JavdBviewed/releases');
    expect(REPO_RELEASES_LATEST_URL).toBe('https://github.com/JavdBviewed/JavdBviewed/releases/latest');
    expect(REPO_ISSUES_URL).toBe('https://github.com/JavdBviewed/JavdBviewed/issues');
    expect(REPO_API_RELEASES_URL).toBe('https://api.github.com/repos/JavdBviewed/JavdBviewed/releases');
    expect(REPO_RAW_PREFIX).toBe('https://raw.githubusercontent.com/JavdBviewed/JavdBviewed');
    expect(REPO_JSDELIVR_PACKAGE_URL).toBe('https://data.jsdelivr.com/v1/packages/gh/JavdBviewed/JavdBviewed');
    expect(getRepoRawUrl('public/routes.json')).toBe(
      'https://raw.githubusercontent.com/JavdBviewed/JavdBviewed/main/public/routes.json',
    );
    expect(getRepoRawUrl('/public/bootstrap.json', 'release/test')).toBe(
      'https://raw.githubusercontent.com/JavdBviewed/JavdBviewed/release/test/public/bootstrap.json',
    );
  });

  it('uses the migrated account as the displayed author identity', () => {
    expect(AUTHOR_NAME).toBe('JavdBviewed');
    expect(AUTHOR_PROFILE_URL).toBe('https://github.com/JavdBviewed');
  });
});
