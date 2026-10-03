export type ResponseCyberProgram = 'daybreak_blue' | 'standard' | 'unknown';

export function normalizeResponseCyberProgram(value: unknown): ResponseCyberProgram | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  switch (value.trim().toLowerCase()) {
    case 'daybreak_blue':
      return 'daybreak_blue';
    case 'standard':
      return 'standard';
    default:
      return 'unknown';
  }
}
