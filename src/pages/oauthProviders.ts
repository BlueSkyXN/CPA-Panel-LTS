import { hasEnabledPluginOAuthProvider } from '@/services/api/plugins';
import type { OAuthProvider } from '@/services/api/oauth';
import type { PluginListEntry } from '@/types';

export function isGeminiCliOAuthPluginAvailable(
  plugins: readonly PluginListEntry[] | null,
  options: { connected: boolean; supportsPlugin: boolean }
): boolean {
  if (!options.connected || !options.supportsPlugin || !plugins) {
    return false;
  }
  return hasEnabledPluginOAuthProvider(plugins, 'gemini-cli');
}

export function getVisibleOAuthProviders<T extends { id: OAuthProvider }>(
  builtinProviders: readonly T[],
  geminiCliProvider: T,
  geminiCliPluginSupported: boolean
): T[] {
  if (!geminiCliPluginSupported) {
    return [...builtinProviders];
  }
  const antigravityIndex = builtinProviders.findIndex((item) => item.id === 'antigravity');
  if (antigravityIndex < 0) {
    return [...builtinProviders, geminiCliProvider];
  }
  return [
    ...builtinProviders.slice(0, antigravityIndex + 1),
    geminiCliProvider,
    ...builtinProviders.slice(antigravityIndex + 1),
  ];
}

export function getGeminiProviderScopeActions(
  geminiCliOAuthSupported: boolean,
  labels: {
    oauth: string;
    credentials: string;
    apiKeys: string;
    quota: string;
  }
): Array<{ path: string; label: string }> {
  const actions: Array<{ path: string; label: string }> = [];
  if (geminiCliOAuthSupported) {
    actions.push({ path: '/oauth?provider=gemini-cli', label: labels.oauth });
  }
  actions.push(
    { path: '/auth-files?provider=gemini-cli', label: labels.credentials },
    { path: '/ai-providers?provider=gemini', label: labels.apiKeys },
    { path: '/quota?provider=gemini-cli', label: labels.quota }
  );
  return actions;
}
