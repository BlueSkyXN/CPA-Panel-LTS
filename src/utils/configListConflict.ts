import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';

function valueOf(node: unknown, active = new Set<object>()): unknown {
  if (isAlias(node)) return ['alias', node.source];
  if (isScalar(node)) return node.value;
  if (!isMap(node) && !isSeq(node)) return node;
  if (active.has(node)) throw new Error('Invalid recursive configuration');
  active.add(node);
  const value = isSeq(node)
    ? node.items.map((item) => valueOf(item, active))
    : Object.fromEntries(node.items.map((pair) => [String(pair.key), valueOf(pair.value, active)]));
  active.delete(node);
  return value;
}

export function assertConfigListsUnchanged(
  beforeYaml: string,
  desiredYaml: string,
  latestYaml: string
): void {
  const parse = (text: string) => {
    const doc = parseDocument(text, { intAsBigInt: true });
    if (doc.errors.length || !isMap(doc.contents)) throw new Error('Invalid configuration mapping');
    return valueOf(doc.contents);
  };
  const equal = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b))
      return a.length === b.length && a.every((item, i) => equal(item, b[i]));
    if (
      !a ||
      !b ||
      typeof a !== 'object' ||
      typeof b !== 'object' ||
      Array.isArray(a) ||
      Array.isArray(b)
    )
      return false;
    const x = a as Record<string, unknown>,
      y = b as Record<string, unknown>;
    return (
      Object.keys(x).length === Object.keys(y).length &&
      Object.keys(x).every(
        (key) => Object.prototype.hasOwnProperty.call(y, key) && equal(x[key], y[key])
      )
    );
  };
  const visit = (before: unknown, desired: unknown, latest: unknown) => {
    if (equal(before, desired)) return;
    if (Array.isArray(before) || Array.isArray(desired)) {
      if (!equal(latest, before) && !equal(latest, desired))
        throw new Error('Configuration list changed concurrently; reload before saving.');
      return;
    }
    const record = (value: unknown): Record<string, unknown> =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const a = record(before),
      b = record(desired),
      c = record(latest);
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
      visit(a[key], b[key], c[key]);
  };
  visit(parse(beforeYaml), parse(desiredYaml), parse(latestYaml));
}
