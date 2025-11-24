import * as vscode from 'vscode';

type SupportedLocale = 'en' | 'zh-cn';

type LocalizationParams = Record<string, string | number>;

type TranslationEntry = Record<SupportedLocale, string>;

const translations = {
  'command.openPreview.noEditor': {
    en: 'No active editor to preview.',
    'zh-cn': '没有可预览的活动编辑器。',
  },
  'command.openPreview.unsupported': {
    en: 'Only supports Markdown files.',
    'zh-cn': '仅支持 Markdown 文件。',
  },
  'command.openPreview.failure': {
    en: 'Unable to open Babel Markdown preview. Check logs.',
    'zh-cn': '无法打开 Babel Markdown 预览。请查看日志。',
  },
  'command.refreshPreview.noPreview': {
    en: 'Open a preview before refreshing.',
    'zh-cn': '请先打开预览，然后再刷新。',
  },
  'command.refreshPreview.failure': {
    en: 'Unable to refresh Babel Markdown preview. Check logs.',
    'zh-cn': '无法刷新 Babel Markdown 预览。请查看日志。',
  },
  'command.openTranslation.noDocument': {
    en: 'No active Markdown document to translate.',
    'zh-cn': '没有可供翻译的活动 Markdown 文档。',
  },
  'command.openTranslation.onlyMarkdown': {
    en: 'Translation preview is only available for Markdown files.',
    'zh-cn': '翻译预览仅适用于 Markdown 文件。',
  },
  'command.openTranslation.missingKey': {
    en: 'Translation API key not set. Run "Babel Markdown: Set Translation API Key" first.',
    'zh-cn': '尚未设置翻译 API 密钥。请先运行“Babel Markdown：设置翻译 API 密钥”。',
  },
  'command.openTranslation.failure': {
    en: 'Unable to open translation preview. Check logs for details.',
    'zh-cn': '无法打开翻译预览。请查看日志了解详情。',
  },
  'command.refreshTranslation.noDocument': {
    en: 'No active Markdown document to refresh.',
    'zh-cn': '没有可刷新的活动 Markdown 文档。',
  },
  'command.refreshTranslation.onlyMarkdown': {
    en: 'Translation preview is only available for Markdown files.',
    'zh-cn': '翻译预览仅适用于 Markdown 文件。',
  },
  'command.refreshTranslation.noPreview': {
    en: 'Open a translation preview before refreshing.',
    'zh-cn': '请先打开翻译预览，然后再刷新。',
  },
  'command.refreshTranslation.failure': {
    en: 'Unable to refresh translation preview. Check logs for details.',
    'zh-cn': '无法刷新翻译预览。请查看日志了解详情。',
  },
  'command.configureApiKey.title': {
    en: 'Set Translation API Key',
    'zh-cn': '设置翻译 API 密钥',
  },
  'command.configureApiKey.prompt': {
    en: 'Enter your OpenAI-compatible API key. Leave empty to clear the stored key. Value is stored securely via VS Code Secret Storage.',
    'zh-cn': '请输入兼容 OpenAI 的 API 密钥。留空将清除已存储的密钥。数值会通过 VS Code 机密存储安全保存。',
  },
  'command.configureApiKey.placeholder': {
    en: 'sk-...your key...',
    'zh-cn': 'sk-...您的密钥...',
  },
  'command.configureApiKey.validation': {
    en: 'Expected an OpenAI-style API key starting with "sk-".',
    'zh-cn': '需要以 “sk-” 开头的 OpenAI 样式 API 密钥。',
  },
  'command.configureApiKey.cleared': {
    en: 'Translation API key cleared.',
    'zh-cn': '已清除翻译 API 密钥。',
  },
  'command.configureApiKey.stored': {
    en: 'Translation API key stored securely.',
    'zh-cn': '已安全保存翻译 API 密钥。',
  },
  'command.configureApiKey.storeError': {
    en: 'Unable to store translation API key. Check logs for details.',
    'zh-cn': '无法保存翻译 API 密钥。请查看日志了解详情。',
  },
  'translation.emptyDocumentMessage': {
    en: 'The source document is empty; nothing to translate.',
    'zh-cn': '源文档为空，无需翻译。',
  },
  'preview.emptyDocumentMessage': {
    en: 'This document is empty.',
    'zh-cn': '此文档为空。',
  },
  'translation.error.base': {
    en: 'Translation failed for {document} → {language}.',
    'zh-cn': '{document} → {language} 的翻译失败。',
  },
  'translation.error.authHint': {
    en: 'Authentication failed. Update the translation API key and try again.',
    'zh-cn': '身份验证失败。请更新翻译 API 密钥后重试。',
  },
  'translation.error.timeoutHint': {
    en: 'The translation request timed out. Increase the timeout or try again.',
    'zh-cn': '翻译请求已超时。请增加超时时间或稍后重试。',
  },
  'translation.error.rateLimitHint': {
    en: 'The translation service rate limit was reached. Wait a moment before retrying.',
    'zh-cn': '已达到翻译服务的速率限制。请稍后再试。',
  },
  'translation.error.networkHint': {
    en: 'Network error. Check the translation API base URL or your internet connection.',
    'zh-cn': '发生网络错误。请检查翻译 API 基础地址或网络连接。',
  },
  'translation.error.unknownHint': {
    en: 'Check the extension output channel for more details and retry.',
    'zh-cn': '请查看扩展输出面板了解详情，然后重试。',
  },
  'translation.error.action.setApiKey': {
    en: 'Set API Key',
    'zh-cn': '设置 API 密钥',
  },
  'translation.error.action.adjustTimeout': {
    en: 'Adjust Timeout',
    'zh-cn': '调整超时',
  },
  'translation.error.action.openSettings': {
    en: 'Open Translation Settings',
    'zh-cn': '打开翻译设置',
  },
  'preview.translationPanelTitle': {
    en: 'Translated: {document}',
    'zh-cn': '翻译：{document}',
  },
  'preview.markdownPanelTitle': {
    en: 'Babel Preview: {document}',
    'zh-cn': 'Babel 预览：{document}',
  },
  'preview.translationWebviewTitle': {
    en: 'Translation Preview',
    'zh-cn': '翻译预览',
  },
  'preview.translationRetryButton': {
    en: 'Retry translation',
    'zh-cn': '重试翻译',
  },
  'preview.translationContentAriaLabel': {
    en: 'Translated Markdown',
    'zh-cn': '翻译后的 Markdown',
  },
  'preview.markdownWindowTitle': {
    en: 'Babel Markdown Preview',
    'zh-cn': 'Babel Markdown 预览',
  },
  'preview.markdownHtmlTitle': {
    en: 'Babel Markdown Preview',
    'zh-cn': 'Babel Markdown 预览',
  },
  'preview.markdownErrorTitle': {
    en: 'Babel Markdown Preview: Error',
    'zh-cn': 'Babel Markdown 预览：错误',
  },
  'preview.markdownErrorHeading': {
    en: 'Preview Error',
    'zh-cn': '预览错误',
  },
  'preview.exportImageButton': {
    en: 'Export as PNG',
    'zh-cn': '导出为 PNG',
  },
  'preview.exportPdfButton': {
    en: 'Export as PDF',
    'zh-cn': '导出为 PDF',
  },
  'preview.exportTargetLabel': {
    en: 'Content',
    'zh-cn': '内容',
  },
  'preview.exportTarget.preview': {
    en: 'Preview Markdown',
    'zh-cn': '预览 Markdown',
  },
  'preview.exportTarget.source': {
    en: 'Original Markdown',
    'zh-cn': '原始 Markdown',
  },
  'preview.exportError': {
    en: 'Unable to prepare the preview for export.',
    'zh-cn': '无法准备预览导出。',
  },
  'preview.exportInProgress': {
    en: 'Preparing export…',
    'zh-cn': '正在准备导出…',
  },
  'common.unknownError': {
    en: 'Unknown error',
    'zh-cn': '未知错误',
  },
  'export.fileFilter.image': {
    en: 'PNG Image',
    'zh-cn': 'PNG 图像',
  },
  'export.fileFilter.pdf': {
    en: 'PDF Document',
    'zh-cn': 'PDF 文档',
  },
  'export.saveLabel.image': {
    en: 'Save PNG',
    'zh-cn': '保存 PNG',
  },
  'export.saveLabel.pdf': {
    en: 'Save PDF',
    'zh-cn': '保存 PDF',
  },
  'export.success.image': {
    en: 'Saved preview as PNG: {path}',
    'zh-cn': '已将预览保存为 PNG：{path}',
  },
  'export.success.pdf': {
    en: 'Saved preview as PDF: {path}',
    'zh-cn': '已将预览保存为 PDF：{path}',
  },
  'export.failure.generic': {
    en: 'Failed to export preview. Check logs for details.',
    'zh-cn': '导出预览失败。请查看日志了解详情。',
  },
  'export.progress.capturing': {
    en: 'Capturing Markdown for export…',
    'zh-cn': '正在捕获 Markdown 以导出…',
  },
  'export.worker.title': {
    en: 'Markdown Export',
    'zh-cn': 'Markdown 导出',
  },
  'webview.statusInProgress': {
    en: 'Translating {document} → {language}{progress}…',
    'zh-cn': '正在翻译 {document} → {language}{progress}…',
  },
  'webview.progressTemplate': {
    en: ' ({current}/{total})',
    'zh-cn': ' ({current}/{total})',
  },
  'webview.statusCompleted': {
    en: 'Translated {document} → {language} — {meta}',
    'zh-cn': '已翻译 {document} → {language} — {meta}',
  },
  'webview.statusCompletedWithWarnings': {
    en: 'Translated {document} → {language} — {meta} (warnings)',
    'zh-cn': '已翻译 {document} → {language} — {meta}（含警告）',
  },
  'webview.statusLastAttempt': {
    en: 'Last attempt · {document} → {language}',
    'zh-cn': '上次尝试 · {document} → {language}',
  },
  'webview.errorMessage': {
    en: 'Failed to translate {document} → {language}: {message}{hint}',
    'zh-cn': '翻译 {document} → {language} 时出错：{message}{hint}',
  },
  'webview.warning.cacheFallback': {
    en: 'Reused cached translations for {count} segment(s) after errors.',
    'zh-cn': '由于错误，已对 {count} 个片段使用缓存结果。',
  },
  'webview.warning.placeholder': {
    en: 'Showing original text for {count} segment(s) because translation failed.',
    'zh-cn': '因翻译失败，{count} 个片段显示原文。',
  },
  'webview.export.imageButton': {
    en: 'Save as PNG',
    'zh-cn': '保存为 PNG',
  },
  'webview.export.pdfButton': {
    en: 'Save as PDF',
    'zh-cn': '保存为 PDF',
  },
  'webview.export.error': {
    en: 'Unable to capture the preview for export.',
    'zh-cn': '无法捕获预览用于导出。',
  },
  'webview.export.inProgress': {
    en: 'Preparing export…',
    'zh-cn': '正在准备导出…',
  },
  'webview.meta.cached': {
    en: 'cached',
    'zh-cn': '缓存命中',
  },
  'webview.meta.recovered': {
    en: 'warnings',
    'zh-cn': '警告',
  },
  'webview.placeholder.currentDocument': {
    en: 'current document',
    'zh-cn': '当前文档',
  },
  'webview.placeholder.configuredLanguage': {
    en: 'configured language',
    'zh-cn': '配置语言',
  },
} as const satisfies Record<string, TranslationEntry>;

export type TranslationKey = keyof typeof translations;

const LANGUAGE_TAGS: Record<SupportedLocale, string> = {
  en: 'en',
  'zh-cn': 'zh-CN',
};

function normalizeLocale(language?: string): SupportedLocale {
  const value = (language ?? vscode.env.language ?? '').toLowerCase();

  if (value.startsWith('zh')) {
    return 'zh-cn';
  }

  return 'en';
}

function format(template: string, params?: LocalizationParams): string {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, token) => {
    const replacement = params[token];

    if (replacement === undefined || replacement === null) {
      return '';
    }

    return String(replacement);
  });
}

export function localize(
  key: TranslationKey,
  params?: LocalizationParams,
  options?: { language?: string },
): string {
  const locale = normalizeLocale(options?.language);
  const entry = translations[key];
  const template = entry?.[locale] ?? entry?.en ?? key;
  return format(template, params);
}

export interface WebviewLocaleBundle {
  languageTag: string;
  pageTitle: string;
  retryButtonLabel: string;
  ariaContentLabel: string;
  placeholders: {
    currentDocument: string;
    configuredLanguage: string;
  };
  translations: {
    statusInProgress: string;
    progressTemplate: string;
    statusCompleted: string;
    statusCompletedWithWarnings: string;
    statusLastAttempt: string;
    errorMessage: string;
    warningCacheFallback: string;
    warningPlaceholder: string;
  };
  meta: {
    cachedLabel: string;
    recoveredLabel: string;
  };
  exportControls: {
    imageButtonLabel: string;
    pdfButtonLabel: string;
    failureMessage: string;
    inProgressMessage: string;
  };
}

export function getWebviewLocaleBundle(language?: string): WebviewLocaleBundle {
  const locale = normalizeLocale(language);

  return {
    languageTag: LANGUAGE_TAGS[locale],
    pageTitle: localize('preview.translationWebviewTitle', undefined, { language }),
    retryButtonLabel: localize('preview.translationRetryButton', undefined, { language }),
    ariaContentLabel: localize('preview.translationContentAriaLabel', undefined, { language }),
    placeholders: {
      currentDocument: localize('webview.placeholder.currentDocument', undefined, { language }),
      configuredLanguage: localize('webview.placeholder.configuredLanguage', undefined, { language }),
    },
    translations: {
      statusInProgress: localize('webview.statusInProgress', undefined, { language }),
      progressTemplate: localize('webview.progressTemplate', undefined, { language }),
      statusCompleted: localize('webview.statusCompleted', undefined, { language }),
      statusCompletedWithWarnings: localize('webview.statusCompletedWithWarnings', undefined, { language }),
      statusLastAttempt: localize('webview.statusLastAttempt', undefined, { language }),
      errorMessage: localize('webview.errorMessage', undefined, { language }),
      warningCacheFallback: localize('webview.warning.cacheFallback', undefined, { language }),
      warningPlaceholder: localize('webview.warning.placeholder', undefined, { language }),
    },
    meta: {
      cachedLabel: localize('webview.meta.cached', undefined, { language }),
      recoveredLabel: localize('webview.meta.recovered', undefined, { language }),
    },
    exportControls: {
      imageButtonLabel: localize('webview.export.imageButton', undefined, { language }),
      pdfButtonLabel: localize('webview.export.pdfButton', undefined, { language }),
      failureMessage: localize('webview.export.error', undefined, { language }),
      inProgressMessage: localize('webview.export.inProgress', undefined, { language }),
    },
  };
}

export function getLanguageTag(language?: string): string {
  const locale = normalizeLocale(language);
  return LANGUAGE_TAGS[locale];
}

export function formatWithLocale(
  key: TranslationKey,
  params?: LocalizationParams,
  options?: { language?: string },
): string {
  return localize(key, params, options);
}
