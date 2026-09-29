/**
 * @file styleInjection.ts
 * @description styleInjection
 * @module features/listEnhancement
 */
// src/features/listEnhancement/ui/styleInjection.ts
import { log } from '../../contentState';
import {
  LIST_ENHANCEMENT_ACTOR_ROW_STYLES,
  LIST_ENHANCEMENT_BASE_STYLES,
  LIST_ENHANCEMENT_WATERMARK_STYLES,
} from './styles';

// 演员水印样式注入标记（A1：原 manager 实例字段；manager 为模块单例，改模块级 flag 语义等价）
let watermarkStylesInjected = false;
// 演员穿透行样式注入标记
let actorRowStylesInjected = false;

export function ensureWatermarkStyles(): void {
  if (watermarkStylesInjected) return;
  try {
    const style = document.createElement('style');
    style.id = 'x-actor-watermark-styles';
    style.textContent = LIST_ENHANCEMENT_WATERMARK_STYLES;
    document.head.appendChild(style);
    watermarkStylesInjected = true;
    log('Actor watermark styles injected');
  } catch (e) {
    log('Failed to inject actor watermark styles:', e);
  }
}

/** 注入演员穿透行样式（小字号、名字间距、日期同行对齐）。 */
export function ensureActorRowStyles(): void {
  if (actorRowStylesInjected) return;
  try {
    const style = document.createElement('style');
    style.id = 'x-ap-actor-row-styles';
    style.textContent = LIST_ENHANCEMENT_ACTOR_ROW_STYLES;
    document.head.appendChild(style);
    actorRowStylesInjected = true;
  } catch (e) {
    log('Failed to inject actor row styles:', e);
  }
}

// 添加必要的CSS样式
function injectStyles(): void {
  const styleId = 'list-enhancement-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = LIST_ENHANCEMENT_BASE_STYLES;

  document.head.appendChild(style);
}

// 自动注入样式
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectStyles);
  } else {
    injectStyles();
  }
}
