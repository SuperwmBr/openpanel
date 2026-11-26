import { createHmac } from 'node:crypto';
import type { IpRiskConfig } from '../../../config';

const MAX_CACHE_ENTRIES = 10_000;
const FAILURE_CACHE_MS = 15_000;
const MANAGED_PROPERTY_KEYS = [
  'iprisk_status',
  'iprisk_classificacao',
  'iprisk_bot_ou_crawler',
  'iprisk_risco_fraude',
  'iprisk_deve_bloquear',
  'iprisk_usuario_real',
  'iprisk_bot_score',
  'iprisk_risk_score',
  'iprisk_avaliacao_humano',
  'iprisk_datacenter',
  'iprisk_vps',
  'iprisk_vpn',
  'iprisk_proxy',
  'iprisk_tor',
  'iprisk_proxy_residencial',
  'iprisk_crawler_bot',
  'iprisk_abuser',
  'iprisk_whitelisted',
  'iprisk_mobile',
  'iprisk_satellite',
  'iprisk_relay',
  'iprisk_icloud_private_relay',
] as const;

type IpriskProperties = Record<string, string | number | boolean>;

interface CacheEntry {
  expiresAt: number;
  properties: IpriskProperties;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<IpriskProperties>>();

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function booleanProperty(
  source: Record<string, unknown>,
  key: string,
  target: string,
  result: IpriskProperties
): void {
  const value = source[key];
  if (typeof value === 'boolean') {
    result[target] = value;
  }
}

function numberProperty(
  source: Record<string, unknown>,
  key: string,
  target: string,
  result: IpriskProperties
): void {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    result[target] = value;
  }
}

function buildProperties(response: unknown): IpriskProperties {
  const root = asRecord(response);
  const final = asRecord(root?.resultado_final);
  if (root?.ok !== true || !final) {
    throw new Error('IPRisk returned an invalid response');
  }

  const properties: IpriskProperties = { iprisk_status: 'ok' };
  const classification = final.classificacao;
  properties.iprisk_classificacao =
    typeof classification === 'string' ? classification : 'INDETERMINADO';

  booleanProperty(final, 'eh_bot_ou_crawler', 'iprisk_bot_ou_crawler', properties);
  booleanProperty(final, 'risco_fraude_final', 'iprisk_risco_fraude', properties);
  booleanProperty(final, 'deve_bloquear', 'iprisk_deve_bloquear', properties);
  booleanProperty(
    final,
    'deve_contabilizar_como_usuario_real',
    'iprisk_usuario_real',
    properties
  );
  numberProperty(final, 'bot_score_0_10', 'iprisk_bot_score', properties);
  numberProperty(final, 'risk_score_0_10', 'iprisk_risk_score', properties);

  const humanAssessment = asRecord(final.avaliacao_humano);
  if (typeof humanAssessment?.status === 'string') {
    properties.iprisk_avaliacao_humano = humanAssessment.status;
  }

  const flags = asRecord(root?.flags);
  if (flags) {
    const flagNames = [
      ['datacenter', 'iprisk_datacenter'],
      ['vps', 'iprisk_vps'],
      ['vpn', 'iprisk_vpn'],
      ['proxy', 'iprisk_proxy'],
      ['tor', 'iprisk_tor'],
      ['proxy_residencial', 'iprisk_proxy_residencial'],
      ['crawler_bot', 'iprisk_crawler_bot'],
      ['abuser', 'iprisk_abuser'],
      ['whitelisted', 'iprisk_whitelisted'],
      ['mobile', 'iprisk_mobile'],
      ['satellite', 'iprisk_satellite'],
      ['relay', 'iprisk_relay'],
      ['apple_icloud_private_relay', 'iprisk_icloud_private_relay'],
    ] as const;
    for (const [source, target] of flagNames) {
      booleanProperty(flags, source, target, properties);
    }
  }

  return properties;
}

function cacheKey(ip: string, apiKey: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return createHmac('sha256', apiKey).update(day).update('\0').update(ip).digest('hex');
}

function nextUtcDay(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

function pruneCache(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    cache.delete(oldest);
  }
}

async function requestClassification(
  ip: string,
  config: IpRiskConfig
): Promise<IpriskProperties> {
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey as string,
      },
      body: JSON.stringify({ ip }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`IPRisk responded with HTTP ${response.status}`);
    }
    return buildProperties(await response.json());
  } catch {
    return { iprisk_status: 'unavailable' };
  }
}

/**
 * The address is sent only to the configured IPRisk endpoint. Cache keys are
 * HMACs scoped to the UTC day, so the process cache does not retain raw IPs.
 */
export async function getIpriskProperties(
  ip: string,
  config: IpRiskConfig
): Promise<IpriskProperties | null> {
  if (!config.apiKey) {
    return null;
  }
  if (!ip) {
    return { iprisk_status: 'missing_ip' };
  }

  const now = new Date();
  const key = cacheKey(ip, config.apiKey, now);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now.getTime()) {
    return cached.properties;
  }
  if (cached) {
    cache.delete(key);
  }

  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }

  const request = requestClassification(ip, config);
  inFlight.set(key, request);
  try {
    const properties = await request;
    const expiresAt =
      properties.iprisk_status === 'ok'
        ? nextUtcDay(now)
        : Math.min(nextUtcDay(now), now.getTime() + FAILURE_CACHE_MS);
    pruneCache(now.getTime());
    cache.set(key, { expiresAt, properties });
    return properties;
  } finally {
    inFlight.delete(key);
  }
}

/** Client-supplied values in this namespace cannot override server verdicts. */
export function removeClientIpriskProperties(
  properties: Record<string, unknown>
): Record<string, unknown> {
  const cleaned = { ...properties };
  for (const key of MANAGED_PROPERTY_KEYS) {
    delete cleaned[key];
  }
  return cleaned;
}
