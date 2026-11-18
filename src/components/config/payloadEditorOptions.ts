import type { TFunction } from 'i18next';
import type { PayloadModelEntry, PayloadParamValidationErrorCode } from '@/types/visualConfig';
import { VISUAL_CONFIG_PROTOCOL_OPTIONS } from '@/hooks/useVisualConfig';

export function getValidationMessage(t: TFunction, errorCode?: PayloadParamValidationErrorCode) {
  if (!errorCode) return undefined;
  return t(`config_management.visual.validation.${errorCode}`);
}

export function buildProtocolOptions(t: TFunction, rules: Array<{ models: PayloadModelEntry[] }>) {
  const options: Array<{ value: string; label: string }> = VISUAL_CONFIG_PROTOCOL_OPTIONS.map(
    (option) => ({
      value: option.value,
      label: t(option.labelKey, { defaultValue: option.defaultLabel }),
    })
  );
  const seen = new Set<string>(options.map((option) => option.value));

  for (const rule of rules) {
    for (const model of rule.models) {
      const protocol = model.protocol;
      if (!protocol || !protocol.trim() || seen.has(protocol)) continue;
      seen.add(protocol);
      options.push({ value: protocol, label: protocol });
    }
  }

  return options;
}

export function buildScopeOptions(t: TFunction, currentScope?: string) {
  const options = [
    {
      value: '',
      label: t('config_management.visual.payload_rules.scope_any'),
    },
    {
      value: 'requested',
      label: t('config_management.visual.payload_rules.scope_requested'),
    },
    {
      value: 'upstream',
      label: t('config_management.visual.payload_rules.scope_upstream'),
    },
  ];
  const trimmedScope = currentScope?.trim();
  if (trimmedScope && !options.some((option) => option.value === trimmedScope)) {
    options.push({
      value: trimmedScope,
      label: t('config_management.visual.payload_rules.scope_custom', { scope: trimmedScope }),
    });
  }
  return options;
}
