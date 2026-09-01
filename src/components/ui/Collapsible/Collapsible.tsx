import {
  useState,
  type HTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { IconChevronDown } from '../icons';
import styles from './Collapsible.module.scss';

interface CollapsibleProps extends HTMLAttributes<HTMLDetailsElement> {
  label: ReactNode;
  hint?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (event: SyntheticEvent<HTMLDetailsElement>) => void;
  flush?: boolean;
}

export function Collapsible({
  label,
  hint,
  defaultOpen = false,
  open,
  onToggle,
  flush,
  children,
  className,
  ...rest
}: PropsWithChildren<CollapsibleProps>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const resolvedOpen = isControlled ? open : uncontrolledOpen;
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!isControlled) {
      setUncontrolledOpen(event.currentTarget.open);
    }
    onToggle?.(event);
  };
  const cls = [styles.root, className].filter(Boolean).join(' ');
  const contentCls = flush ? styles.contentFlush : styles.content;
  return (
    <details className={cls} onToggle={handleToggle} open={resolvedOpen} {...rest}>
      <summary className={styles.summary}>
        <span className={styles.summaryLabel}>
          <span>{label}</span>
          {hint ? <span className={styles.summaryHint}>{hint}</span> : null}
        </span>
        <span className={styles.chevron} aria-hidden="true">
          <IconChevronDown size={16} />
        </span>
      </summary>
      <div className={contentCls}>{children}</div>
    </details>
  );
}
