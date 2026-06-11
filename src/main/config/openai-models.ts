/**
 * @module main/config/openai-models
 *
 * Lists models from any OpenAI-compatible endpoint (`GET {baseUrl}/models`).
 * Used by the in-chat ModelPicker and the API settings to populate the model
 * list for `openai` / `custom` (OpenAI protocol) providers such as FPT AI
 * Marketplace (https://mkp-api.fptcloud.com/v1).
 *
 * Mirrors the parsing/caching style of ollama-api.ts but stays provider-agnostic.
 */
import * as crypto from 'crypto';
import type { ProviderModelInfo } from '../../renderer/types';

const MODELS_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 10000;

const cache = new Map<string, { expiresAt: number; models: ProviderModelInfo[] }>();
const inflight = new Map<string, Promise<ProviderModelInfo[]>>();

export function resetOpenAIModelIndexCache(): void {
  cache.clear();
  inflight.clear();
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function buildHeaders(apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const trimmed = apiKey?.trim();
  if (trimmed) {
    headers.Authorization = `Bearer ${trimmed}`;
  }
  return headers;
}

function buildCacheKey(baseUrl: string, apiKey: string | undefined): string {
  const trimmed = apiKey?.trim() || '';
  // Hash the key so it is never stored in plain text in the cache key.
  const keyHash = trimmed
    ? crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 16)
    : '';
  return `${baseUrl}::${keyHash}`;
}

function parseModels(data: unknown): ProviderModelInfo[] {
  // OpenAI shape: { data: [{ id }, ...] }. Some servers return a bare array.
  const list = (data as { data?: unknown })?.data;
  const arr = Array.isArray(list) ? list : Array.isArray(data) ? data : [];
  return arr
    .map((item: unknown): ProviderModelInfo | null => {
      const raw = item as { id?: unknown };
      const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
      return id ? { id, name: id } : null;
    })
    .filter((item): item is ProviderModelInfo => Boolean(item));
}

/**
 * Fetch the available models from an OpenAI-compatible `/models` endpoint.
 * Returns [] when no baseUrl is provided. Throws on HTTP/network errors so the
 * caller can surface auth/connectivity problems to the user.
 */
export async function listOpenAICompatibleModels(input: {
  baseUrl?: string;
  apiKey?: string;
}): Promise<ProviderModelInfo[]> {
  const baseUrl = normalizeBaseUrl(input.baseUrl || '');
  if (!baseUrl) {
    return [];
  }

  const cacheKey = buildCacheKey(baseUrl, input.apiKey);
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.models;
  }

  const existing = inflight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const request = (async (): Promise<ProviderModelInfo[]> => {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: buildHeaders(input.apiKey),
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `HTTP ${response.status}`);
    }
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Failed to parse models response: ${text.slice(0, 200)}`);
    }
    const models = parseModels(data);
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, models });
    return models;
  })();

  inflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    inflight.delete(cacheKey);
  }
}
