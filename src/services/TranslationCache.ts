import type * as vscode from 'vscode';

import type {
  CachedSegmentResult,
  RawTranslationResult,
  ResolvedTranslationConfiguration,
  TranslationResult,
} from '../types/translation';
import { hashObject } from '../utils/hash';

type DocumentLike = Pick<vscode.TextDocument, 'uri' | 'version'>;

interface CacheKey {
  uri: string;
  version: number;
  configHash: string;
}

interface CacheEntry {
  key: CacheKey;
  result: TranslationResult;
  timestamp: number;
}

interface SegmentCacheEntry {
  key: SegmentCacheKey;
  result: RawTranslationResult;
  timestamp: number;
}

interface SegmentCacheKey {
  fingerprint: string;
}

export class TranslationCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly segmentCache = new Map<string, SegmentCacheEntry>();
  private readonly segmentOwners = new Map<string, Set<string>>();
  private readonly documentSegments = new Map<string, Set<string>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly maxSegmentEntries: number;

  constructor(options?: { maxEntries?: number; ttlMs?: number; segmentMaxEntries?: number }) {
    this.maxEntries = options?.maxEntries ?? 16;
    this.ttlMs = options?.ttlMs ?? 1000 * 60 * 5;
    this.maxSegmentEntries = options?.segmentMaxEntries ?? this.maxEntries * 8;
  }

  get(
    document: DocumentLike,
    resolvedConfig: ResolvedTranslationConfiguration,
  ): TranslationResult | undefined {
    const key = this.buildKey(document, resolvedConfig);
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.result;
  }

  set(
    document: DocumentLike,
    resolvedConfig: ResolvedTranslationConfiguration,
    result: TranslationResult,
  ): void {
    const key = this.buildKey(document, resolvedConfig);

    if (this.cache.size >= this.maxEntries) {
      this.evictOne();
    }

    this.cache.set(key, {
      key: this.parseKey(key),
      result,
      timestamp: Date.now(),
    });
  }

  clearForDocument(document: DocumentLike): void {
    const prefix = `${document.uri.toString()}::`;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }

    const documentUri = document.uri.toString();
    const fingerprints = this.documentSegments.get(documentUri);

    if (fingerprints) {
      for (const fingerprint of fingerprints) {
        const owners = this.segmentOwners.get(fingerprint);
        if (owners) {
          owners.delete(documentUri);
          if (owners.size === 0) {
            this.segmentOwners.delete(fingerprint);
            this.segmentCache.delete(fingerprint);
          }
        } else {
          this.segmentCache.delete(fingerprint);
        }
      }
      this.documentSegments.delete(documentUri);
    }
  }

  getSegment(
    document: DocumentLike,
    resolvedConfig: ResolvedTranslationConfiguration,
    segmentMarkdown: string,
  ): CachedSegmentResult | undefined {
    const fingerprint = this.buildSegmentFingerprint(resolvedConfig, segmentMarkdown);
    const entry = this.segmentCache.get(fingerprint);

    if (!entry) {
      return undefined;
    }

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.deleteSegmentEntry(fingerprint);
      return undefined;
    }

    entry.timestamp = Date.now();
    this.associateSegmentWithDocument(fingerprint, document.uri.toString());

    return {
      fingerprint,
      markdown: entry.result.markdown,
      providerId: entry.result.providerId,
      latencyMs: entry.result.latencyMs,
    };
  }

  setSegment(
    document: DocumentLike,
    resolvedConfig: ResolvedTranslationConfiguration,
    segmentMarkdown: string,
    result: RawTranslationResult,
  ): void {
    const fingerprint = this.buildSegmentFingerprint(resolvedConfig, segmentMarkdown);

    this.segmentCache.set(fingerprint, {
      key: { fingerprint },
      result,
      timestamp: Date.now(),
    });

    this.associateSegmentWithDocument(fingerprint, document.uri.toString());
    this.enforceSegmentCapacity();
  }

  private buildKey(
    document: DocumentLike,
    resolvedConfig: ResolvedTranslationConfiguration,
  ): string {
    const configHash = hashObject({
      apiBaseUrl: resolvedConfig.apiBaseUrl,
      model: resolvedConfig.model,
      targetLanguage: resolvedConfig.targetLanguage,
    });

    return `${document.uri.toString()}::${document.version}::${configHash}`;
  }

  private buildSegmentFingerprint(
    resolvedConfig: ResolvedTranslationConfiguration,
    segmentMarkdown: string,
  ): string {
    const normalized = segmentMarkdown.replace(/\r\n/g, '\n').trim();

    return hashObject({
      content: normalized,
      model: resolvedConfig.model,
      targetLanguage: resolvedConfig.targetLanguage,
      apiBaseUrl: resolvedConfig.apiBaseUrl,
    });
  }

  private parseKey(key: string): CacheKey {
    const [uri, version, configHash] = key.split('::');

    return {
      uri,
      version: Number(version),
      configHash,
    };
  }

  private evictOne(): void {
    let oldestKey: string | undefined;
    let oldestTs = Number.POSITIVE_INFINITY;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTs) {
        oldestKey = key;
        oldestTs = entry.timestamp;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  private deleteSegmentEntry(fingerprint: string): void {
    const entry = this.segmentCache.get(fingerprint);
    if (!entry) {
      return;
    }

    this.segmentCache.delete(fingerprint);

    const owners = this.segmentOwners.get(fingerprint);
    if (owners) {
      for (const documentUri of owners) {
        const set = this.documentSegments.get(documentUri);
        if (set) {
          set.delete(fingerprint);
          if (set.size === 0) {
            this.documentSegments.delete(documentUri);
          }
        }
      }
      this.segmentOwners.delete(fingerprint);
    }
  }

  private associateSegmentWithDocument(fingerprint: string, documentUri: string): void {
    let owners = this.segmentOwners.get(fingerprint);
    if (!owners) {
      owners = new Set<string>();
      this.segmentOwners.set(fingerprint, owners);
    }

    if (!owners.has(documentUri)) {
      owners.add(documentUri);

      let docSegments = this.documentSegments.get(documentUri);
      if (!docSegments) {
        docSegments = new Set<string>();
        this.documentSegments.set(documentUri, docSegments);
      }
      docSegments.add(fingerprint);
    }
  }

  private enforceSegmentCapacity(): void {
    if (this.segmentCache.size <= this.maxSegmentEntries) {
      return;
    }

    let oldestFingerprint: string | undefined;
    let oldestTs = Number.POSITIVE_INFINITY;

    for (const [fingerprint, entry] of this.segmentCache.entries()) {
      if (entry.timestamp < oldestTs) {
        oldestFingerprint = fingerprint;
        oldestTs = entry.timestamp;
      }
    }

    if (oldestFingerprint) {
      this.deleteSegmentEntry(oldestFingerprint);
    }
  }
}
