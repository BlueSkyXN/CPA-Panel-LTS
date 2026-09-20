import { parseDocument } from 'yaml';

/**
 * Re-serialize server YAML with the same options the visual merge writes, so a
 * diff only shows real value changes instead of formatting noise.
 */
export function normalizeYamlForVisualDiff(yamlContent: string): string {
  try {
    const doc = parseDocument(yamlContent);
    return doc.toString({ indent: 2, lineWidth: 120, minContentWidth: 0 });
  } catch {
    return yamlContent;
  }
}
