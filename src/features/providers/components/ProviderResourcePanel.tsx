import { useTranslation } from 'react-i18next';
import { IconPlus, IconSearch } from '@/components/ui/icons';
import type { ProviderRecentUsageMap } from '@/components/providers/utils';
import { PROVIDER_LOGOS } from '../brandLogos';
import type { ProviderGroup, ProviderResource } from '../types';
import { ProviderResourceTable } from './ProviderResourceTable';
import { ProviderResourceToolbar } from './ProviderResourceToolbar';
import type { ProviderSortBy, SortDir } from '../types';
import styles from './ProviderResourcePanel.module.scss';

export interface ProviderPanelControls {
  sortBy: ProviderSortBy;
  sortDir: SortDir;
  onSortBy: (value: ProviderSortBy) => void;
  onSortDir: (value: SortDir) => void;
  availableModels: ReadonlyArray<string>;
  selectedModels: ReadonlySet<string>;
  onSelectedModelsChange: (next: Set<string>) => void;
}

interface ProviderResourcePanelProps {
  group: ProviderGroup;
  filter: string;
  onFilterChange: (value: string) => void;
  filteredResources: ProviderResource[];
  selectedId: string | null;
  disableMutations?: boolean;
  usageByProvider?: ProviderRecentUsageMap;
  toolbarControls?: ProviderPanelControls;
  onView: (resource: ProviderResource) => void;
  onEdit: (resource: ProviderResource) => void;
  onDelete: (resource: ProviderResource) => void;
  onToggleDisabled?: (resource: ProviderResource, disabled: boolean) => void;
  onCreate: () => void;
}

export function ProviderResourcePanel({
  group,
  filter,
  onFilterChange,
  filteredResources,
  selectedId,
  disableMutations,
  usageByProvider,
  toolbarControls,
  onView,
  onEdit,
  onDelete,
  onToggleDisabled,
  onCreate,
}: ProviderResourcePanelProps) {
  const { t } = useTranslation();
  const logo = PROVIDER_LOGOS[group.id];
  const providerTitle = t(`providersPage.providerNames.${group.id}`);
  const logoClassName = styles.logo;

  const titleContent = (
    <>
      {logo ? (
        <img src={logo.src} alt="" aria-hidden="true" className={logoClassName} />
      ) : null}
      <h2 className={styles.title}>{providerTitle}</h2>
    </>
  );

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerMain}>
          <div className={styles.titleArea}>
            <div className={styles.titleRow}>{titleContent}</div>
          </div>
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon} aria-hidden="true">
              <IconSearch size={16} />
            </span>
            <input
              type="search"
              className={styles.searchInput}
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder={t('providersPage.table.filterPlaceholder')}
            />
          </div>
        </div>
        {toolbarControls ? (
          <div className={styles.headerToolbarRow}>
            <ProviderResourceToolbar
              key={group.id}
              sortBy={toolbarControls.sortBy}
              sortDir={toolbarControls.sortDir}
              onSortBy={toolbarControls.onSortBy}
              onSortDir={toolbarControls.onSortDir}
              availableModels={toolbarControls.availableModels}
              selectedModels={toolbarControls.selectedModels}
              onSelectedModelsChange={toolbarControls.onSelectedModelsChange}
            />
          </div>
        ) : null}
      </div>

      {filteredResources.length === 0 ? (
        <div className={styles.empty}>
          <div>{t('providersPage.table.empty')}</div>
          <div className={styles.emptyAction}>
            <button type="button" className={styles.emptyActionButton} onClick={onCreate}>
              <IconPlus size={16} />
              <span>{t('providersPage.actions.new')}</span>
            </button>
          </div>
        </div>
      ) : (
        <ProviderResourceTable
          resources={filteredResources}
          selectedId={selectedId}
          disableMutations={disableMutations}
          usageByProvider={usageByProvider}
          onView={onView}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleDisabled={onToggleDisabled}
        />
      )}
    </section>
  );
}
