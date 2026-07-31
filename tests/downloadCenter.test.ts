import { describe, expect, it } from 'vitest'
import {
  formatFileSize,
  parseCloudRelease,
  parseExtensionRelease,
} from '../vitepress/.vitepress/components/downloadCenter'

describe('download center release data', () => {
  it('selects the extension ZIP from the latest GitHub release', () => {
    const release = parseExtensionRelease({
      tag_name: 'v1.21.4',
      html_url: 'https://github.com/lmixture/JavdBviewed/releases/tag/v1.21.4',
      assets: [
        {
          name: 'checksums.txt',
          browser_download_url: 'https://github.com/example/checksums.txt',
          size: 120,
        },
        {
          name: 'javdb-extension-v1.21.4-build-27.zip',
          browser_download_url: 'https://github.com/example/extension.zip',
          size: 3_049_327,
        },
      ],
    })

    expect(release).toEqual({
      version: '1.21.4',
      releaseUrl: 'https://github.com/lmixture/JavdBviewed/releases/tag/v1.21.4',
      asset: {
        name: 'javdb-extension-v1.21.4-build-27.zip',
        downloadUrl: 'https://github.com/example/extension.zip',
        size: 3_049_327,
      },
    })
    expect(formatFileSize(3_049_327)).toBe('2.9 MB')
  })

  it('rejects a latest release without a downloadable extension ZIP', () => {
    expect(parseExtensionRelease({
      tag_name: 'v1.21.4',
      html_url: 'https://github.com/lmixture/JavdBviewed/releases/tag/v1.21.4',
      assets: [],
    })).toBeNull()
  })

  it('accepts only known Cloud release states', () => {
    const manifest = {
      product: 'javdbviewed-cloud',
      channel: 'stable',
      releaseStatus: 'preparing',
      latest: {
        version: '1.0.0',
        image: 'ghcr.io/lmixture/javdbviewed-cloud:1.0.0',
        releaseNotesUrl: 'https://github.com/lmixture/JavdBviewed-release/blob/main/releases/cloud/v1.0.0.md',
      },
    }

    expect(parseCloudRelease(manifest)?.releaseStatus).toBe('preparing')
    expect(parseCloudRelease({ ...manifest, releaseStatus: 'draft' })).toBeNull()
  })
})
