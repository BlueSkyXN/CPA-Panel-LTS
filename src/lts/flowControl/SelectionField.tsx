import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import styles from './styles.module.scss';
export interface SelectionOption {
    value: string;
    label: string;
}
interface Props {
    label: string;
    value: string[] | undefined;
    options: SelectionOption[];
    onChange: (value: string[] | undefined) => void;
    disabled?: boolean;
    allowCustom?: boolean;
    allowAll?: boolean;
}
// All is explicit. Clearing a selected collection leaves [], which validation
// rejects; it must never silently broaden the selection to every future model.
export function SelectionField({ label, value, options, onChange, disabled = false, allowCustom = false, allowAll = true }: Props) {
    const { t } = useTranslation();
    const id = useId();
    const [search, setSearch] = useState(''), [custom, setCustom] = useState('');
    const items = useMemo(() => { const map = new Map(options.map(o => [o.value, o])); for (const v of value ?? [])
        if (!map.has(v))
            map.set(v, { value: v, label: `${v} (${t('flow_control.v3_saved')})` }); return [...map.values()].sort((a, b) => a.label.localeCompare(b.label)); }, [options, value, t]);
    const filtered = items.filter(o => `${o.label} ${o.value}`.toLowerCase().includes(search.toLowerCase())).slice(0, 200);
    const toggle = (item: string, checked: boolean) => onChange(checked ? [...new Set([...(value ?? []), item])].slice(0, 256) : (value ?? []).filter(v => v !== item));
    const add = () => { const v = custom.trim(); if (!v || v === '*')
        return; toggle(v, true); setCustom(''); };
    return <fieldset className={styles.selection} disabled={disabled}><legend>{label}</legend>
  {allowAll && <div className={styles.actions}><label><input type="radio" name={id} checked={value === undefined} onChange={() => onChange(undefined)}/>{t('flow_control.v3_all_dynamic')}</label><label><input type="radio" name={id} checked={value !== undefined} onChange={() => onChange([])}/>{t('flow_control.v3_selected')}</label></div>}
  <details open={value !== undefined}><summary>{value === undefined ? t('flow_control.v3_all_dynamic') : t('flow_control.v3_selected_count', { count: value.length })}</summary>
   <input aria-label={`${label} ${t('flow_control.v3_search')}`} className={styles.searchBox} value={search} onChange={e => setSearch(e.target.value)} placeholder={t('flow_control.v3_search')}/>
   <div className={styles.actions}><Button type="button" size="sm" variant="ghost" onClick={() => onChange([...new Set([...(value ?? []), ...filtered.map(v => v.value)])].slice(0, 256))}>{t('flow_control.v3_select_results')}</Button><Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>{t('flow_control.v3_clear')}</Button></div>
   <div className={styles.checkList}>{filtered.map(o => <label key={o.value}><input type="checkbox" checked={value?.includes(o.value) ?? false} onChange={e => toggle(o.value, e.target.checked)}/><span>{o.label}</span></label>)}</div>
   {allowCustom && <div className={styles.actions}><input className={styles.customInput} aria-label={t('flow_control.v3_custom_model')} value={custom} placeholder={t('flow_control.v3_custom_model')} onChange={e => setCustom(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') {
        e.preventDefault();
        add();
    } }}/><Button type="button" size="sm" variant="secondary" disabled={!custom.trim() || custom === '*'} onClick={add}>{t('flow_control.v3_add')}</Button></div>}
  </details>
  {value?.length === 0 && <p className={styles.warning} role="status">{t('flow_control.invalid_selection')}</p>}
 </fieldset>;
}
