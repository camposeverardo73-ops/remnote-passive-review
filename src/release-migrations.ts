import type { RNPlugin } from '@remnote/plugin-sdk';
import { migrateLegacyBundledSourceAssets } from './mindmap-source-store';

export const PLUGIN_DATA_VERSION_KEY = 'mindmap-plugin-data-version';
export const CURRENT_PLUGIN_DATA_VERSION = 1;

export type ReleaseMigrationStatus = {
  from_version: number;
  to_version: number;
  legacy_asset: 'NOT_NEEDED' | 'MIGRATED' | 'PENDING_ASSET';
  pending_reason?: string;
};

/**
 * Release migrations are deliberately additive and idempotent. They never reset
 * existing classification, region, Rem, Card, scheduler, or repetition data.
 */
export async function ensureReleaseMigrations(plugin: RNPlugin): Promise<ReleaseMigrationStatus> {
  const storedVersion = await plugin.storage.getSynced<number>(PLUGIN_DATA_VERSION_KEY);
  const fromVersion = Number.isFinite(storedVersion) ? Number(storedVersion) : 0;

  const legacy = await migrateLegacyBundledSourceAssets(plugin);
  if (legacy.status !== 'PENDING_ASSET') {
    await plugin.storage.setSynced(PLUGIN_DATA_VERSION_KEY, CURRENT_PLUGIN_DATA_VERSION);
  }

  return {
    from_version: fromVersion,
    to_version: CURRENT_PLUGIN_DATA_VERSION,
    legacy_asset: legacy.status,
    pending_reason: legacy.status === 'PENDING_ASSET' ? legacy.reason : undefined,
  };
}
