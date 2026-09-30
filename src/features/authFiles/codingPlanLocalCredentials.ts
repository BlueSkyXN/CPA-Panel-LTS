interface ClientPlatform {
  platform?: string;
  userAgent?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string; mobile?: boolean };
}

export function isMacOSClient(
  client: ClientPlatform | undefined = typeof navigator === 'undefined' ? undefined : navigator
): boolean {
  if (!client) return false;
  const platform = client.userAgentData?.platform || client.platform || '';
  const userAgent = client.userAgent || '';
  if (client.userAgentData?.mobile || /iPad|iPhone|iPod|Android/i.test(userAgent)) return false;
  // iPadOS desktop mode reports MacIntel, but still has multiple touch points.
  if (/mac/i.test(platform) && (client.maxTouchPoints ?? 0) > 1) return false;
  return /mac/i.test(platform) || (!platform && /Macintosh|Mac OS X/i.test(userAgent));
}

const macCommand = (keyPath: string, file: string): string =>
  `(v=$(plutil -extract ${keyPath} raw -expect string "$HOME/.zcode/v2/${file}") && [ -n "$v" ] && [ "\${v#enc:}" = "$v" ] && printf '%s\\n' "$v" | tee /dev/tty | pbcopy)`;

export const CODING_PLAN_MAC_API_KEY_COMMANDS = {
  bigmodel: macCommand('provider.builtin:bigmodel-coding-plan.options.apiKey', 'config.json'),
  zai: macCommand('provider.builtin:zai-coding-plan.options.apiKey', 'config.json'),
} as const;

export const CODING_PLAN_MAC_DEVICE_ID_COMMAND = macCommand('deviceMid', 'telemetry-state.json');
