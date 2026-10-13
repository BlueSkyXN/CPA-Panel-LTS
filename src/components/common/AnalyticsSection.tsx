import type { ReactNode } from 'react';
import styles from './AnalyticsSection.module.scss';

/** Consistent section hierarchy for monitoring and analytics panels. */
export function AnalyticsSection({ title, description, children, level = 2 }: {
  title: string;
  description?: string;
  children: ReactNode;
  level?: 2 | 3;
}) {
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <section className={styles.section} aria-label={title}>
      <header className={styles.header}>
        <Heading>{title}</Heading>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
  );
}
