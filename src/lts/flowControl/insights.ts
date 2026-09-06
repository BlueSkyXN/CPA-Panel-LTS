import { dimensionsForRule, selectionOf, type FlowRule, type FlowReference } from './model';
export function referenceLabel(ref: string | undefined, refs: FlowReference[]): string {
    if (!ref || ref === '*')
        return '*';
    return refs.find(v => v.ref === ref)?.label ?? (ref === 'anonymous' ? 'anonymous' : ref.slice(0, 12));
}
// Human-readable descriptions only. Admission, live usage and overlapping-set
// evaluation are computed by Core's preview endpoint, not a second JS limiter.
export function ruleSentence(r: FlowRule, refs: {
    keys: FlowReference[];
    accounts: FlowReference[];
    credentials?: FlowReference[];
}, locale: string | boolean = 'zh-CN'): string {
    const lang = typeof locale === 'boolean' ? (locale ? 'zh-CN' : 'en') : locale;
    const zh = lang.startsWith('zh'), tw = lang === 'zh-TW', ru = lang.startsWith('ru');
    const labels: Record<string, string> = zh ? { key: tw ? '調用方' : '调用方', model: tw ? '模型' : '模型', account: tw ? '上游帳號' : '上游账号', provider: 'Provider', 'auth-kind': tw ? '認證類型' : '认证类型', credential: tw ? '舊憑據' : '旧凭据' } : ru ? { key: 'ключ клиента', model: 'модель', account: 'аккаунт', provider: 'провайдер', 'auth-kind': 'тип входа', credential: 'старые учётные данные' } : { key: 'caller', model: 'model', account: 'upstream account', provider: 'provider', 'auth-kind': 'auth type', credential: 'legacy credential' };
    const filters: string[] = [];
    for (const [field, name, list] of [['keys', 'key', refs.keys], ['accounts', 'account', refs.accounts], ['models', 'model', []]] as const) {
        const values = selectionOf(r, field);
        if (values !== undefined)
            filters.push(`${labels[name]} ∈ {${values.map(v => name === 'model' ? v : referenceLabel(v, list as FlowReference[])).join(', ')}}`);
    }
    if (r.provider && r.provider !== '*')
        filters.push(`Provider=${r.provider}`);
    if (r['auth-kind'] && r['auth-kind'] !== '*')
        filters.push(`${labels['auth-kind']}=${r['auth-kind']}`);
    const dims = dimensionsForRule(r).map(v => labels[v] ?? v).join(' × ');
    const audience = filters.join(' · ') || (zh ? (tw ? '全部請求' : '全部请求') : ru ? 'Все запросы' : 'All traffic');
    const group = dims ? (zh ? (tw ? `每個 ${dims} 分別計數` : `每个 ${dims} 分别计数`) : ru ? `Отдельно для ${dims}` : `Separately per ${dims}`) : (zh ? (tw ? '全部匹配請求共享總量' : '全部匹配请求共享总量') : ru ? 'Общий предел для выбранных запросов' : 'All matching requests share one total');
    const unit = r.stage === 'request' ? (zh ? (tw ? '已啟動調用' : '已启动调用') : ru ? 'вызовов' : 'started calls') : (zh ? (tw ? '上游執行' : '上游执行') : ru ? 'выполнений' : 'upstream attempts');
    return `${audience} — ${group}; ${r['max-concurrent'] > 0 ? (zh ? (tw ? `最多 ${r['max-concurrent']} 個${unit}` : `最多 ${r['max-concurrent']} 个${unit}`) : ru ? `Не более ${r['max-concurrent']} ${unit}` : `At most ${r['max-concurrent']} ${unit}`) : (zh ? (tw ? '無並發上限' : '无并发上限') : ru ? 'Без лимита параллелизма' : 'No concurrency cap')}${r.windows?.length ? ` · ${r.windows.map(w => `${w.requests}/${w['period-ms']} ms`).join(' ∩ ')}` : ''}`;
}
export function policyFingerprint(rules: FlowRule[]): string {
    return JSON.stringify(rules.map(r => ({ id: r.id, stage: r.stage, dims: dimensionsForRule(r), keys: selectionOf(r, 'keys')?.slice().sort(), models: selectionOf(r, 'models')?.map(v => v.toLowerCase()).sort(), accounts: selectionOf(r, 'accounts')?.slice().sort(), provider: r.provider, kind: r['auth-kind'], max: r['max-concurrent'], windows: r.windows })).sort((a, b) => a.id.localeCompare(b.id)));
}
