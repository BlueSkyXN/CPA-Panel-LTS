import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useConfigFieldControls, type ConfigFieldsProps } from './ConfigFieldControls';
import { ConfigDomainPanel, FlowControlPanel } from './ConfigDomainPanels';
import { getConfigIssueFields } from './configIssues';
import {
  CONFIG_DOMAINS,
  CONFIG_FIELDS,
  domainLabelKey,
  pageLabelKey,
  fieldTargetId,
  locateConfigField,
  resolveConfigLocation,
  searchConfigFields,
  type ConfigDomainId,
  type ConfigLocation,
  type ConfigFieldId,
} from './configNavigation';
import styles from './VisualConfigEditor.module.scss';

interface Props extends ConfigFieldsProps {
  initialSection?: string | null;
  initialSubsection?: string | null;
  initialField?: string | null;
  dirtyFields?: ReadonlySet<string>;
  sourceDirty?: boolean;
  hasPayloadValidationErrors?: boolean;
  onNavigate?: (location: ConfigLocation) => void;
}

function focusConfigField(field: ConfigFieldId) {
  const element = document.getElementById(fieldTargetId(field));
  if (!element) return;
  const disclosure = element.querySelector(':scope > details');
  if (disclosure instanceof HTMLDetailsElement) disclosure.open = true;
  let parent = element.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  const target =
    Array.from(
      element.querySelectorAll<HTMLElement>(
        'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), summary'
      )
    ).find((control) => control.getClientRects().length > 0) ?? element;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'center', behavior: 'instant' });
}

export function VisualConfigEditor({
  initialSection,
  initialSubsection,
  initialField,
  dirtyFields,
  sourceDirty,
  onNavigate,
  ...props
}: Props) {
  const { t } = useTranslation();
  const compact = useMediaQuery('(max-width: 1180px)');
  const labelId = useId();
  const requested = useMemo(
    () => resolveConfigLocation(initialSection, initialSubsection, initialField),
    [initialSection, initialSubsection, initialField]
  );
  const [location, setLocation] = useState(requested);
  const [lastRequested, setLastRequested] = useState(requested);
  const lastPages = useRef<Partial<Record<ConfigDomainId, string>>>({
    [requested.section]: requested.subsection,
  });
  const [visited, setVisited] = useState(
    () => new Set([`${requested.section}/${requested.subsection}`])
  );
  const [query, setQuery] = useState('');
  const [focusField, setFocusField] = useState<ConfigFieldId | undefined>(requested.field);
  const controls = useConfigFieldControls(props);
  const issues = useMemo(
    () => getConfigIssueFields(props.values, props.validationErrors),
    [props.values, props.validationErrors]
  );
  const results = useMemo(() => searchConfigFields(query, t), [query, t]);
  const domain = CONFIG_DOMAINS.find((d) => d.id === location.section)!;

  if (lastRequested !== requested) {
    setLastRequested(requested);
    setLocation(requested);
    setVisited((current) => new Set([...current, `${requested.section}/${requested.subsection}`]));
    setFocusField(query.trim() ? undefined : requested.field);
  }
  useEffect(() => {
    lastPages.current[requested.section] = requested.subsection;
  }, [requested]);
  useEffect(() => {
    if (!focusField) return;
    const frame = requestAnimationFrame(() => {
      focusConfigField(focusField);
      setFocusField(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusField, location]);

  const navigate = (next: ConfigLocation) => {
    setLocation(next);
    lastPages.current[next.section] = next.subsection;
    setVisited((current) => new Set([...current, `${next.section}/${next.subsection}`]));
    setQuery('');
    setFocusField(next.field);
    onNavigate?.(next);
    if (!next.field)
      requestAnimationFrame(() =>
        document.getElementById('config-page-heading')?.scrollIntoView({ block: 'nearest' })
      );
  };
  const selectDomain = (id: string) => {
    const next = CONFIG_DOMAINS.find((d) => d.id === id)!;
    navigate({ section: next.id, subsection: lastPages.current[next.id] ?? next.pages[0].id });
  };
  const countErrors = (fields: readonly string[]) =>
    fields.filter((f) => issues.has(f as ConfigFieldId)).length;
  const changed = (fields: readonly string[]) =>
    fields.some(
      (f) =>
        dirtyFields?.has(f) ||
        (f === 'codexAbnormalReasoningRetryAction' &&
          dirtyFields?.has('codexAbnormalReasoningRetryEnabled'))
    );
  const accessible = (title: string, count: number, dirty: boolean) =>
    [
      title,
      count ? t('config_management.meta_errors', { count }) : '',
      dirty ? t('config_management.editor.changed') : '',
    ]
      .filter(Boolean)
      .join(', ');

  return (
    <div className={styles.visualEditor}>
      <div className={styles.editorSearch}>
        <Input
          value={query}
          onChange={(event) => {
            setFocusField(undefined);
            setQuery(event.target.value);
          }}
          aria-label={t('config_management.editor.search')}
          placeholder={t('config_management.editor.search')}
          type="search"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
            if (event.key === 'Enter' && results[0]) {
              event.preventDefault();
              navigate(results[0].location);
            }
          }}
        />
        {query.trim() && (
          <div
            className={styles.searchResults}
            aria-label={t('config_management.editor.search_results')}
          >
            <p role="status">
              {results.length
                ? t('config_management.editor.results_count', { count: results.length })
                : t('config_management.editor.no_results')}
            </p>
            <ul>
              {results.map((result) => (
                <li key={result.field}>
                  <button
                    type="button"
                    data-config-search-field={result.field}
                    onClick={() => navigate(result.location)}
                  >
                    <strong>{result.label}</strong>
                    <span>
                      {t(domainLabelKey(result.location.section))} /{' '}
                      {t(pageLabelKey(result.location.section, result.location.subsection))}
                    </span>
                    <code>{result.yamlKey}</code>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <details
        className={`${styles.configHelp} ${styles.editorHelp}`}
        data-testid="config-editor-help"
      >
        <summary>{t('config_management.editor.guidance.editor_help')}</summary>
        <p>{t('config_management.editor.guidance.reading')}</p>
      </details>
      {sourceDirty && (
        <p className={styles.contextNotice}>{t('config_management.editor.source_dirty')}</p>
      )}
      {issues.size > 0 && (
        <details className={styles.errorSummary} open>
          <summary>
            {t('config_management.editor.review_errors')} · {issues.size}
          </summary>
          <ul>
            {[...issues].map((field) => (
              <li key={field}>
                <button
                  type="button"
                  onClick={() => {
                    const target = locateConfigField(field);
                    if (target) navigate(target);
                  }}
                >
                  {t(CONFIG_FIELDS[field].labelKey)}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {location.migrated && (
        <div className={styles.contextNotice}>
          {t('config_management.editor.legacy_notice')}
          {['headers', 'codex-policy', 'flow-control', 'compatibility'].map((id) => (
            <button key={id} type="button" onClick={() => selectDomain(id)}>
              {t(domainLabelKey(id))}
            </button>
          ))}
        </div>
      )}
      <div className={styles.editorWorkspace}>
        {compact ? (
          <div className={styles.compactNavigation}>
            <span id={labelId} className={styles.srOnly}>
              {t('config_management.editor.navigation')}
            </span>
            <Select
              value={location.section}
              ariaLabelledBy={labelId}
              options={CONFIG_DOMAINS.map((d) => ({ value: d.id, label: t(domainLabelKey(d.id)) }))}
              onChange={selectDomain}
            />
            <Select
              value={location.subsection}
              ariaLabel={t(domainLabelKey(domain.id))}
              options={domain.pages.map((p) => ({
                value: p.id,
                label: accessible(
                  t(pageLabelKey(domain.id, p.id)),
                  countErrors(p.fields),
                  changed(p.fields)
                ),
              }))}
              onChange={(subsection) => navigate({ section: domain.id, subsection })}
            />
          </div>
        ) : (
          <nav
            className={styles.editorNavigation}
            aria-label={t('config_management.editor.navigation')}
          >
            {(['foundation', 'requests', 'features'] as const).map((group) => (
              <div key={group} className={styles.directoryGroup}>
                <h2>{t(`config_management.editor.${group}`)}</h2>
                <ul>
                  {CONFIG_DOMAINS.filter((d) => d.group === group).map((d) => {
                    const fields = d.pages.flatMap((p) => [...p.fields]);
                    const count = countErrors(fields);
                    const dirty = changed(fields);
                    return (
                      <li key={d.id}>
                        <button
                          type="button"
                          data-config-domain={d.id}
                          aria-expanded={location.section === d.id}
                          aria-controls={`config-nav-${d.id}`}
                          className={styles.directoryDomain}
                          aria-label={accessible(t(domainLabelKey(d.id)), count, dirty)}
                          onClick={() => selectDomain(d.id)}
                        >
                          <span>{t(domainLabelKey(d.id))}</span>
                          {dirty && <span className={styles.changeDot} aria-hidden="true" />}
                          {count > 0 && <span className={styles.navBadge}>{count}</span>}
                        </button>
                        <ul
                          id={`config-nav-${d.id}`}
                          hidden={location.section !== d.id}
                          className={styles.directoryPages}
                        >
                          {d.pages.map((p) => (
                            <li key={p.id}>
                              <button
                                type="button"
                                data-config-nav={`${d.id}/${p.id}`}
                                aria-current={
                                  location.section === d.id && location.subsection === p.id
                                    ? 'page'
                                    : undefined
                                }
                                aria-label={accessible(
                                  t(pageLabelKey(d.id, p.id)),
                                  countErrors(p.fields),
                                  changed(p.fields)
                                )}
                                onClick={() => navigate({ section: d.id, subsection: p.id })}
                              >
                                <span>{t(pageLabelKey(d.id, p.id))}</span>
                                {changed(p.fields) && (
                                  <span className={styles.changeDot} aria-hidden="true" />
                                )}
                                {countErrors(p.fields) > 0 && (
                                  <span className={styles.navBadge}>{countErrors(p.fields)}</span>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        )}
        <div className={styles.editorContent}>
          <header id="config-page-heading" className={styles.editorHeading}>
            <p>{t(domainLabelKey(location.section))}</p>
            <h2>{t(pageLabelKey(location.section, location.subsection))}</h2>
          </header>
          <p className={styles.pageIntroduction} data-testid="config-page-introduction">
            {t(
              `config_management.editor.guidance.pages.${location.section}.${location.subsection}`
            )}
          </p>
          {CONFIG_DOMAINS.filter((d) => d.id !== 'flow-control').flatMap((d) =>
            d.pages.map((page) => {
              if (!visited.has(`${d.id}/${page.id}`)) return null;
              return (
                <section
                  key={`${d.id}/${page.id}`}
                  hidden={location.section !== d.id || location.subsection !== page.id}
                  data-config-page={`${d.id}/${page.id}`}
                >
                  <ConfigDomainPanel
                    section={d.id}
                    {...props}
                    controls={controls}
                    issueFields={issues}
                    page={page}
                    active={location.section === d.id && location.subsection === page.id}
                    onNavigate={navigate}
                  />
                </section>
              );
            })
          )}
          {[...visited].some((key) => key.startsWith('flow-control/')) && (
            <section
              hidden={location.section !== 'flow-control'}
              data-config-page={`flow-control/${location.subsection}`}
            >
              <FlowControlPanel
                {...props}
                active={location.section === 'flow-control'}
                page={location.section === 'flow-control' ? location.subsection : 'rules'}
              />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
