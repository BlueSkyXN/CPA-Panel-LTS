import { useState, type ReactNode } from 'react';
import { Collapsible } from '@/components/ui/Collapsible/Collapsible';
import styles from './VisualConfigEditor.module.scss';

export function RuleDisclosure({
  label,
  action,
  defaultOpen = false,
  hasErrors = false,
  children,
}: {
  label: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  hasErrors?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible
      className={styles.ruleDisclosure}
      label={label}
      action={action}
      open={hasErrors || open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      flush
    >
      {children}
    </Collapsible>
  );
}
