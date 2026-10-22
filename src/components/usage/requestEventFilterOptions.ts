import type { SelectOption } from '@/components/ui/Select';

const nameCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const compareValues = (left: string, right: string) =>
  nameCollator.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0);

export const buildRequestEventFilterOptions = (
  values: readonly string[],
  selectedValue: string,
  allOption: SelectOption
): SelectOption[] => {
  const uniqueValues = new Set(values);
  // Keep an absent selection active when the time window has no matching events.
  uniqueValues.add(selectedValue);
  uniqueValues.delete(allOption.value);

  return [
    allOption,
    ...Array.from(uniqueValues)
      .sort(compareValues)
      .map((value) => ({ value, label: value })),
  ];
};
