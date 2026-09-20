import { getPayloadParamValidationError } from '@/hooks/useVisualConfig';
import type { VisualConfigValidationErrors, VisualConfigValues } from '@/types/visualConfig';
import type { ConfigFieldId } from './configNavigation';

export function getConfigIssueFields(
  values: VisualConfigValues,
  errors: VisualConfigValidationErrors = {}
): Set<ConfigFieldId> {
  const fields = new Set<ConfigFieldId>();
  for (const [field, error] of Object.entries(errors))
    if (error && field !== 'flowControlRulesText') fields.add(field as ConfigFieldId);
  for (const field of [
    'payloadDefaultRules',
    'payloadDefaultRawRules',
    'payloadOverrideRules',
    'payloadOverrideRawRules',
  ] as const) {
    const raw = field.includes('Raw');
    if (
      values[field].some(
        (rule) =>
          rule.params.some((p) =>
            getPayloadParamValidationError(raw ? { ...p, valueType: 'json' } : p)
          ) ||
          rule.models.some((model) =>
            [...(model.match ?? []), ...(model.notMatch ?? [])].some((p) =>
              getPayloadParamValidationError(p)
            )
          )
      )
    )
      fields.add(field);
  }
  return fields;
}
