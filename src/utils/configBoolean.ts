// yaml.v3 accepts these YAML 1.1 strings when decoding a typed bool field.
export function readConfigBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  switch (value) {
    case 'y':
    case 'Y':
    case 'yes':
    case 'Yes':
    case 'YES':
    case 'on':
    case 'On':
    case 'ON':
      return true;
    case 'n':
    case 'N':
    case 'no':
    case 'No':
    case 'NO':
    case 'off':
    case 'Off':
    case 'OFF':
      return false;
    default:
      return fallback;
  }
}
