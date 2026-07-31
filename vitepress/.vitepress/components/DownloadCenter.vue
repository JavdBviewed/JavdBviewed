<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  formatFileSize,
  parseCloudRelease,
  parseExtensionRelease,
  type CloudRelease,
  type ExtensionRelease,
} from './downloadCenter'

const EXTENSION_API_URL = 'https://api.github.com/repos/lmixture/JavdBviewed/releases/latest'
const EXTENSION_RELEASES_URL = 'https://github.com/lmixture/JavdBviewed/releases'
const CLOUD_MANIFEST_URL = 'https://raw.githubusercontent.com/lmixture/JavdBviewed-release/main/manifests/cloud/stable.json'

const extension = ref<ExtensionRelease | null>(null)
const extensionState = ref<'loading' | 'ready' | 'fallback'>('loading')
const cloud = ref<CloudRelease>({
  version: '1.0.0',
  releaseStatus: 'preparing',
  image: 'ghcr.io/lmixture/javdbviewed-cloud:1.0.0',
  releaseNotesUrl: 'https://github.com/lmixture/JavdBviewed-release/blob/main/releases/cloud/v1.0.0.md',
})
const cloudState = ref<'loading' | 'ready' | 'fallback'>('loading')

async function loadExtensionRelease(): Promise<void> {
  try {
    const response = await fetch(EXTENSION_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`)

    const parsed = parseExtensionRelease(await response.json())
    if (!parsed) throw new Error('No extension ZIP found in latest release')

    extension.value = parsed
    extensionState.value = 'ready'
  } catch (error) {
    console.warn('扩展版本信息加载失败，已使用 Releases 回退入口。', error)
    extensionState.value = 'fallback'
  }
}

async function loadCloudRelease(): Promise<void> {
  try {
    const response = await fetch(CLOUD_MANIFEST_URL, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`Cloud manifest returned ${response.status}`)

    const parsed = parseCloudRelease(await response.json())
    if (!parsed) throw new Error('Cloud manifest format is invalid')

    cloud.value = parsed
    cloudState.value = 'ready'
  } catch (error) {
    console.warn('Cloud 发布状态加载失败，已保留已知准备状态。', error)
    cloudState.value = 'fallback'
  }
}

onMounted(() => {
  void loadExtensionRelease()
  void loadCloudRelease()
})
</script>

<template>
  <section class="download-center" aria-labelledby="download-products-title">
    <div class="download-heading">
      <div>
        <p class="download-kicker">发布中心</p>
        <h2 id="download-products-title">选择使用方式</h2>
      </div>
      <a class="manifest-link" :href="CLOUD_MANIFEST_URL" target="_blank" rel="noreferrer">
        stable 清单
      </a>
    </div>

    <div class="product-grid">
      <article class="product-card product-card--extension">
        <div class="product-topline">
          <span class="product-mark" aria-hidden="true">EX</span>
          <span class="status status--released">
            {{ extensionState === 'ready' ? '已发布' : extensionState === 'loading' ? '查询中' : '前往 Releases' }}
          </span>
        </div>
        <h3>浏览器扩展</h3>
        <p v-if="extension">
          v{{ extension.version }} · {{ extension.asset.name }}
          <span v-if="formatFileSize(extension.asset.size)"> · {{ formatFileSize(extension.asset.size) }}</span>
        </p>
        <p v-else-if="extensionState === 'loading'">正在读取 GitHub 最新版本与下载资产。</p>
        <p v-else>GitHub API 暂时不可用，可在 Releases 页面选择最新扩展 ZIP。</p>
        <div class="product-actions">
          <a
            class="primary-action"
            :href="extension?.asset.downloadUrl ?? EXTENSION_RELEASES_URL"
            target="_blank"
            rel="noreferrer"
          >
            {{ extension ? '下载 ZIP' : '打开 Releases' }}
          </a>
          <a
            v-if="extension"
            class="secondary-action"
            :href="extension.releaseUrl"
            target="_blank"
            rel="noreferrer"
          >
            版本说明
          </a>
        </div>
      </article>

      <article class="product-card product-card--cloud">
        <div class="product-topline">
          <span class="product-mark" aria-hidden="true">CL</span>
          <span :class="['status', cloud.releaseStatus === 'released' ? 'status--released' : 'status--preparing']">
            {{ cloud.releaseStatus === 'released' ? '已发布' : '发布准备中' }}
          </span>
        </div>
        <h3>Cloud 容器</h3>
        <p>v{{ cloud.version }} · stable<span v-if="cloudState === 'fallback'"> · 状态源暂不可用</span></p>
        <code>{{ cloud.image }}</code>
        <div class="product-actions">
          <a class="primary-action" href="#cloud-deploy">
            {{ cloud.releaseStatus === 'released' ? '开始部署' : '查看部署说明' }}
          </a>
          <a class="secondary-action" :href="cloud.releaseNotesUrl" target="_blank" rel="noreferrer">
            发布说明
          </a>
        </div>
      </article>

      <article class="product-card product-card--desktop product-card--preview">
        <div class="product-topline">
          <span class="product-mark" aria-hidden="true">PC</span>
          <span class="status status--preview">预告</span>
        </div>
        <h3>桌面端</h3>
        <p>面向 Windows 等桌面平台，下载入口尚未开放。</p>
        <span class="preview-note">版本与发布日期将在准备完成后公布</span>
      </article>

      <article class="product-card product-card--android product-card--preview">
        <div class="product-topline">
          <span class="product-mark" aria-hidden="true">AN</span>
          <span class="status status--preview">预告</span>
        </div>
        <h3>Android</h3>
        <p>移动客户端正在准备，暂不提供安装包或测试链接。</p>
        <span class="preview-note">正式开放时将在这里提供下载</span>
      </article>
    </div>
  </section>
</template>

<style scoped>
.download-center {
  margin: 24px 0 40px;
}

.download-heading,
.product-topline,
.product-actions {
  display: flex;
  align-items: center;
}

.download-heading {
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.download-heading h2 {
  margin: 2px 0 0;
  border: 0;
  padding: 0;
  font-size: 22px;
}

.download-kicker {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 700;
}

.manifest-link,
.secondary-action {
  color: var(--vp-c-brand-1);
  font-size: 14px;
  font-weight: 600;
}

.product-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.product-card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 238px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 18px;
  background: var(--vp-c-bg-soft);
  box-shadow: inset 3px 0 0 var(--product-accent);
}

.product-card--extension { --product-accent: #d97706; }
.product-card--cloud { --product-accent: #16836f; }
.product-card--desktop { --product-accent: #3971b7; }
.product-card--android { --product-accent: #7a5c9e; }

.product-topline {
  justify-content: space-between;
  gap: 12px;
}

.product-mark {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--product-accent) 45%, var(--vp-c-divider));
  border-radius: 6px;
  color: var(--product-accent);
  font-size: 12px;
  font-weight: 800;
}

.status {
  border-radius: 999px;
  padding: 4px 9px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.status--released {
  background: color-mix(in srgb, #16836f 13%, transparent);
  color: #11705f;
}

.status--preparing {
  background: color-mix(in srgb, #d97706 14%, transparent);
  color: #a45105;
}

.status--preview {
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
}

.product-card h3 {
  margin: 18px 0 8px;
  font-size: 18px;
}

.product-card p {
  min-height: 48px;
  margin: 0 0 14px;
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.product-card code {
  display: block;
  margin: -4px 0 14px;
  color: var(--vp-c-text-2);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.product-actions {
  flex-wrap: wrap;
  gap: 12px;
  margin-top: auto;
}

.primary-action {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  padding: 0 15px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white);
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
}

.primary-action:hover {
  background: var(--vp-c-brand-2);
  color: var(--vp-c-white);
}

.primary-action:focus-visible,
.secondary-action:focus-visible,
.manifest-link:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 3px;
}

.preview-note {
  display: block;
  margin-top: auto;
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 13px;
  color: var(--vp-c-text-3);
  font-size: 13px;
  line-height: 1.5;
}

@media (max-width: 640px) {
  .download-heading {
    align-items: flex-end;
  }

  .product-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .product-card {
    min-height: 0;
  }

  .product-card p {
    min-height: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .primary-action {
    transition: none;
  }
}
</style>
