export type ExtensionRelease = {
  version: string
  releaseUrl: string
  asset: {
    name: string
    downloadUrl: string
    size: number
  }
}

export type CloudRelease = {
  version: string
  releaseStatus: 'preparing' | 'released'
  image: string
  releaseNotesUrl: string
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\//.test(value)
}

export function parseExtensionRelease(value: unknown): ExtensionRelease | null {
  if (!isRecord(value) || typeof value.tag_name !== 'string' || !isHttpUrl(value.html_url)) {
    return null
  }

  const assets = Array.isArray(value.assets) ? value.assets : []
  const candidates = assets.flatMap((asset): ExtensionRelease['asset'][] => {
    if (
      !isRecord(asset)
      || typeof asset.name !== 'string'
      || !isHttpUrl(asset.browser_download_url)
      || typeof asset.size !== 'number'
    ) {
      return []
    }

    const normalizedName = asset.name.toLowerCase()
    const isExtensionZip = normalizedName.endsWith('.zip')
      && /(extension|chrome|chromium)/.test(normalizedName)

    return isExtensionZip
      ? [{ name: asset.name, downloadUrl: asset.browser_download_url, size: asset.size }]
      : []
  })

  const asset = candidates[0]
  if (!asset) return null

  return {
    version: value.tag_name.replace(/^v/i, ''),
    releaseUrl: value.html_url,
    asset,
  }
}

export function parseCloudRelease(value: unknown): CloudRelease | null {
  if (
    !isRecord(value)
    || value.product !== 'javdbviewed-cloud'
    || value.channel !== 'stable'
    || (value.releaseStatus !== 'preparing' && value.releaseStatus !== 'released')
    || !isRecord(value.latest)
    || typeof value.latest.version !== 'string'
    || typeof value.latest.image !== 'string'
    || !isHttpUrl(value.latest.releaseNotesUrl)
  ) {
    return null
  }

  return {
    version: value.latest.version,
    releaseStatus: value.releaseStatus,
    image: value.latest.image,
    releaseNotesUrl: value.latest.releaseNotesUrl,
  }
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
