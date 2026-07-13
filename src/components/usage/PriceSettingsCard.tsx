import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import type { ModelPrice } from '@/utils/usage';
import { resolveCacheWriteUnitPrice } from '@/utils/usage/cacheTokens';
import { parseNonNegativePrice } from '@/utils/usage/modelPrices';
import styles from '@/pages/UsagePage.module.scss';

export interface PriceSettingsCardProps {
  modelNames: string[];
  modelPrices: Record<string, ModelPrice>;
  onPricesChange: (prices: Record<string, ModelPrice>) => void;
}

export function PriceSettingsCard({
  modelNames,
  modelPrices,
  onPricesChange,
}: PriceSettingsCardProps) {
  const { t } = useTranslation();

  // Add form state
  const [selectedModel, setSelectedModel] = useState('');
  const [promptPrice, setPromptPrice] = useState('');
  const [completionPrice, setCompletionPrice] = useState('');
  const [cachePrice, setCachePrice] = useState('');
  const [cacheWritePrice, setCacheWritePrice] = useState('');

  // Edit modal state
  const [editModel, setEditModel] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [editCompletion, setEditCompletion] = useState('');
  const [editCache, setEditCache] = useState('');
  const [editCacheWrite, setEditCacheWrite] = useState('');

  const parseOptionalPrice = (value: string): number | undefined => {
    if (value.trim() === '') return undefined;
    return parseNonNegativePrice(value);
  };

  const isInvalidPriceInput = (value: string): boolean =>
    value.trim() !== '' && parseNonNegativePrice(value) === undefined;

  const promptPriceInvalid = isInvalidPriceInput(promptPrice);
  const completionPriceInvalid = isInvalidPriceInput(completionPrice);
  const cachePriceInvalid = isInvalidPriceInput(cachePrice);
  const cacheWritePriceInvalid = isInvalidPriceInput(cacheWritePrice);
  const addPriceInvalid =
    promptPriceInvalid || completionPriceInvalid || cachePriceInvalid || cacheWritePriceInvalid;

  const editPromptInvalid = isInvalidPriceInput(editPrompt);
  const editCompletionInvalid = isInvalidPriceInput(editCompletion);
  const editCacheInvalid = isInvalidPriceInput(editCache);
  const editCacheWriteInvalid = isInvalidPriceInput(editCacheWrite);
  const editPriceInvalid =
    editPromptInvalid || editCompletionInvalid || editCacheInvalid || editCacheWriteInvalid;
  const invalidPriceMessage = t('usage_stats.model_price_invalid');

  const handleSavePrice = () => {
    if (!selectedModel || addPriceInvalid) return;
    const prompt = parseNonNegativePrice(promptPrice) ?? 0;
    const completion = parseNonNegativePrice(completionPrice) ?? 0;
    const cache = cachePrice.trim() === '' ? prompt : (parseNonNegativePrice(cachePrice) ?? 0);
    const cacheWrite = parseOptionalPrice(cacheWritePrice);
    const newPrices = {
      ...modelPrices,
      [selectedModel]: {
        prompt,
        completion,
        cache,
        ...(cacheWrite !== undefined ? { cacheWrite } : {}),
      },
    };
    onPricesChange(newPrices);
    setSelectedModel('');
    setPromptPrice('');
    setCompletionPrice('');
    setCachePrice('');
    setCacheWritePrice('');
  };

  const handleDeletePrice = (model: string) => {
    const newPrices = { ...modelPrices };
    delete newPrices[model];
    onPricesChange(newPrices);
  };

  const handleOpenEdit = (model: string) => {
    const price = modelPrices[model];
    setEditModel(model);
    setEditPrompt(price?.prompt?.toString() || '');
    setEditCompletion(price?.completion?.toString() || '');
    setEditCache(price?.cache?.toString() || '');
    setEditCacheWrite(price?.cacheWrite?.toString() || '');
  };

  const handleSaveEdit = () => {
    if (!editModel || editPriceInvalid) return;
    const prompt = parseNonNegativePrice(editPrompt) ?? 0;
    const completion = parseNonNegativePrice(editCompletion) ?? 0;
    const cache = editCache.trim() === '' ? prompt : (parseNonNegativePrice(editCache) ?? 0);
    const cacheWrite = parseOptionalPrice(editCacheWrite);
    const newPrices = {
      ...modelPrices,
      [editModel]: {
        prompt,
        completion,
        cache,
        ...(cacheWrite !== undefined ? { cacheWrite } : {}),
      },
    };
    onPricesChange(newPrices);
    setEditModel(null);
  };

  const handleModelSelect = (value: string) => {
    setSelectedModel(value);
    const price = modelPrices[value];
    if (price) {
      setPromptPrice(price.prompt.toString());
      setCompletionPrice(price.completion.toString());
      setCachePrice(price.cache.toString());
      setCacheWritePrice(price.cacheWrite?.toString() || '');
    } else {
      setPromptPrice('');
      setCompletionPrice('');
      setCachePrice('');
      setCacheWritePrice('');
    }
  };

  const options = useMemo(
    () => [
      { value: '', label: t('usage_stats.model_price_select_placeholder') },
      ...modelNames.map((name) => ({ value: name, label: name })),
    ],
    [modelNames, t]
  );

  return (
    <Card title={t('usage_stats.model_price_settings')}>
      <div className={styles.pricingSection}>
        {/* Price Form */}
        <div className={styles.priceForm}>
          <div className={styles.formRow}>
            <div className={styles.formField}>
              <label htmlFor="usage-model-price-model">{t('usage_stats.model_name')}</label>
              <Select
                id="usage-model-price-model"
                value={selectedModel}
                options={options}
                onChange={handleModelSelect}
                placeholder={t('usage_stats.model_price_select_placeholder')}
              />
            </div>
            <div className={styles.formField}>
              <label htmlFor="usage-prompt-price">
                {t('usage_stats.model_price_prompt')} ($/1M)
              </label>
              <Input
                id="usage-prompt-price"
                type="number"
                value={promptPrice}
                onChange={(e) => setPromptPrice(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.0001"
                error={promptPriceInvalid ? invalidPriceMessage : undefined}
              />
            </div>
            <div className={styles.formField}>
              <label htmlFor="usage-completion-price">
                {t('usage_stats.model_price_completion')} ($/1M)
              </label>
              <Input
                id="usage-completion-price"
                type="number"
                value={completionPrice}
                onChange={(e) => setCompletionPrice(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.0001"
                error={completionPriceInvalid ? invalidPriceMessage : undefined}
              />
            </div>
            <div className={styles.formField}>
              <label htmlFor="usage-cache-read-price">
                {t('usage_stats.model_price_cache')} ($/1M)
              </label>
              <Input
                id="usage-cache-read-price"
                type="number"
                value={cachePrice}
                onChange={(e) => setCachePrice(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.0001"
                error={cachePriceInvalid ? invalidPriceMessage : undefined}
              />
            </div>
            <div className={styles.formField}>
              <label htmlFor="usage-cache-write-price">
                {t('usage_stats.model_price_cache_write')} ($/1M)
              </label>
              <Input
                id="usage-cache-write-price"
                type="number"
                value={cacheWritePrice}
                onChange={(e) => setCacheWritePrice(e.target.value)}
                placeholder={t('usage_stats.model_price_cache_write_auto')}
                min="0"
                step="0.0001"
                aria-describedby="usage-cache-write-price-hint"
                error={cacheWritePriceInvalid ? invalidPriceMessage : undefined}
              />
            </div>
            <Button
              variant="primary"
              onClick={handleSavePrice}
              disabled={!selectedModel || addPriceInvalid}
            >
              {t('common.save')}
            </Button>
          </div>
          <div id="usage-cache-write-price-hint" className={styles.priceFieldHint}>
            {t('usage_stats.model_price_cache_write_hint')}
          </div>
        </div>

        {/* Saved Prices List */}
        <div className={styles.pricesList}>
          <h4 className={styles.pricesTitle}>{t('usage_stats.saved_prices')}</h4>
          {Object.keys(modelPrices).length > 0 ? (
            <div className={styles.pricesGrid}>
              {Object.entries(modelPrices).map(([model, price]) => (
                <div key={model} className={styles.priceItem}>
                  <div className={styles.priceInfo}>
                    <span className={styles.priceModel}>{model}</span>
                    <div className={styles.priceMeta}>
                      <span>
                        {t('usage_stats.model_price_prompt')}: ${price.prompt.toFixed(4)}/1M
                      </span>
                      <span>
                        {t('usage_stats.model_price_completion')}: ${price.completion.toFixed(4)}/1M
                      </span>
                      <span>
                        {t('usage_stats.model_price_cache')}: ${price.cache.toFixed(4)}/1M
                      </span>
                      <span>
                        {t('usage_stats.model_price_cache_write')}: $
                        {resolveCacheWriteUnitPrice(
                          model,
                          price.prompt,
                          price.cache,
                          price.cacheWrite
                        ).toFixed(4)}
                        /1M
                        {price.cacheWrite === undefined
                          ? ` (${t('usage_stats.model_price_cache_write_auto')})`
                          : ''}
                      </span>
                    </div>
                  </div>
                  <div className={styles.priceActions}>
                    <Button variant="secondary" size="sm" onClick={() => handleOpenEdit(model)}>
                      {t('common.edit')}
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => handleDeletePrice(model)}>
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.hint}>{t('usage_stats.model_price_empty')}</div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      <Modal
        open={editModel !== null}
        title={editModel ?? ''}
        onClose={() => setEditModel(null)}
        footer={
          <div className={styles.priceActions}>
            <Button variant="secondary" onClick={() => setEditModel(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={handleSaveEdit} disabled={editPriceInvalid}>
              {t('common.save')}
            </Button>
          </div>
        }
        width={420}
      >
        <div className={styles.editModalBody}>
          <div className={styles.formField}>
            <label htmlFor="usage-prompt-price-edit">
              {t('usage_stats.model_price_prompt')} ($/1M)
            </label>
            <Input
              id="usage-prompt-price-edit"
              type="number"
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.0001"
              error={editPromptInvalid ? invalidPriceMessage : undefined}
            />
          </div>
          <div className={styles.formField}>
            <label htmlFor="usage-completion-price-edit">
              {t('usage_stats.model_price_completion')} ($/1M)
            </label>
            <Input
              id="usage-completion-price-edit"
              type="number"
              value={editCompletion}
              onChange={(e) => setEditCompletion(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.0001"
              error={editCompletionInvalid ? invalidPriceMessage : undefined}
            />
          </div>
          <div className={styles.formField}>
            <label htmlFor="usage-cache-read-price-edit">
              {t('usage_stats.model_price_cache')} ($/1M)
            </label>
            <Input
              id="usage-cache-read-price-edit"
              type="number"
              value={editCache}
              onChange={(e) => setEditCache(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.0001"
              error={editCacheInvalid ? invalidPriceMessage : undefined}
            />
          </div>
          <div className={styles.formField}>
            <label htmlFor="usage-cache-write-price-edit">
              {t('usage_stats.model_price_cache_write')} ($/1M)
            </label>
            <Input
              id="usage-cache-write-price-edit"
              type="number"
              value={editCacheWrite}
              onChange={(e) => setEditCacheWrite(e.target.value)}
              placeholder={t('usage_stats.model_price_cache_write_auto')}
              min="0"
              step="0.0001"
              aria-describedby="usage-cache-write-price-edit-hint"
              error={editCacheWriteInvalid ? invalidPriceMessage : undefined}
            />
            <span id="usage-cache-write-price-edit-hint" className={styles.priceFieldHint}>
              {t('usage_stats.model_price_cache_write_hint')}
            </span>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
