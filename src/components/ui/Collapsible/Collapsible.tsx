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
  /**
   * Optional row action rendered inside the summary, before the chevron.
   * Callers must call `event.preventDefault()` and `event.stopPropagation()`
   * in interactive handlers, otherwise the summary's default toggle fires.
   */
  action?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (event: SyntheticEvent<HTMLDetailsElement>) => void;
  flush?: boolean;
}

export function Collapsible({
  label,
  hint,
  action,
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
        {action ? <span className={styles.summaryAction}>{action}</span> : null}
        <span className={styles.chevron} aria-hidden="true">
          <IconChevronDown size={16} />
        </span>
      </summary>
      <div className={contentCls}>{children}</div>
    </details>
  );
}
