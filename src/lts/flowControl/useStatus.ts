import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores';
import { computeApiUrl } from '@/utils/connection';
import { asRecord, canObserveLive, mergeSummary, parseFlowCapabilities, parseFlowEvent, type FlowSupport, type FlowStatus } from './model';
import { FlowSSEDecoder } from './sse';
export type FlowLiveState = 'off' | 'connecting' | 'live' | 'reconnecting' | 'paused' | 'disabled' | 'error';
export function useFlowControlStatus() {
    const apiBase = useAuthStore(s => s.apiBase), managementKey = useAuthStore(s => s.managementKey), connectionStatus = useAuthStore(s => s.connectionStatus);
    const [revision, setRevision] = useState(0), [support, setSupport] = useState<FlowSupport>({ state: 'loading' });
    const supportRef = useRef(support);
    supportRef.current = support;
    const [live, setLive] = useState(false), [liveState, setLiveState] = useState<FlowLiveState>('off');
    const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
    const [history, setHistory] = useState<Array<{
        requests: number;
        attempts: number;
        waiting: number;
    }>>([]);
    useEffect(() => { const change = () => setVisible(!document.hidden); document.addEventListener('visibilitychange', change); return () => document.removeEventListener('visibilitychange', change); }, []);
    useEffect(() => { let stopped = false; setSupport({ state: 'loading' }); setHistory([]); if (connectionStatus === 'connected')
        void apiClient.get<unknown>('/flow-control').then(raw => { if (stopped)
            return; const data = parseFlowCapabilities(raw); setSupport(data ? { state: 'ready', data } : { state: 'unsupported' }); }).catch((error: unknown) => { if (stopped)
            return; const x = asRecord(error); setSupport({ state: x?.status === 404 || x?.status === 501 ? 'unsupported' : 'error' }); }); return () => { stopped = true; }; }, [apiBase, managementKey, connectionStatus, revision]);
    const ready = support.state === 'ready' && support.data.supported;
    const enabled = canObserveLive(support.state === 'ready' ? support.data : null);
    const interval = support.state === 'ready' ? support.data['events-interval-ms'] : 2000;
    useEffect(() => {
        if (!live) {
            setLiveState('off');
            return;
        }
        if (!visible) {
            setLiveState('paused');
            return;
        }
        if (!ready || connectionStatus !== 'connected') {
            setLiveState('connecting');
            return;
        }
        if (!enabled) {
            setLiveState('disabled');
            return;
        } // Deliberately NO polling fallback.
        let stopped = false, permanent = false, controller: AbortController | undefined, retry: ReturnType<typeof setTimeout> | undefined, watchdog: ReturnType<typeof setTimeout> | undefined, failures = 0;
        const initial = supportRef.current;
        let lastRevision: number | undefined = initial.state === 'ready' ? initial.data.state['policy-revision'] : undefined;
        let lastProcess = initial.state === 'ready' ? initial.data.state['process-id'] ?? '' : '';
        const clearWatchdog = () => { if (watchdog)
            clearTimeout(watchdog); };
        const accept = (state: FlowStatus) => {
            if (stopped)
                return;
            setSupport(old => old.state === 'ready' ? { state: 'ready', data: { ...old.data, state: mergeSummary(old.data.state, state) } } : old);
            const restarted = !!lastProcess && lastProcess !== state['process-id'];
            lastProcess = state['process-id'] ?? '';
            setHistory(old => [...(restarted ? [] : old), { requests: state['active-requests'], attempts: state['active-attempts'], waiting: state.waiting }].slice(-60));
            if ((lastRevision !== undefined && state['policy-revision'] !== lastRevision) || restarted) {
                void apiClient.get<unknown>('/flow-control').then(raw => { if (stopped)
                    return; const data = parseFlowCapabilities(raw); if (data)
                    setSupport({ state: 'ready', data }); }).catch(() => { });
            }
            lastRevision = state['policy-revision'];
        };
        const connect = async () => {
            if (stopped || permanent)
                return;
            controller = new AbortController();
            setLiveState(failures ? 'reconnecting' : 'connecting');
            const resetWatchdog = () => { clearWatchdog(); watchdog = setTimeout(() => controller?.abort(), Math.max(15000, interval * 3 + 5000)); };
            resetWatchdog();
            try {
                const response = await fetch(`${computeApiUrl(apiBase)}/flow-control/events`, { headers: { Authorization: `Bearer ${managementKey}`, Accept: 'text/event-stream' }, signal: controller.signal, cache: 'no-store', redirect: 'error' });
                if ([401, 403, 404, 409, 501].includes(response.status)) {
                    permanent = true;
                    if (!stopped)
                        setLiveState(response.status === 409 ? 'disabled' : 'error');
                    await response.body?.cancel().catch(() => { });
                    return;
                }
                if (!response.ok || !response.body)
                    throw new Error('Observation unavailable');
                const reader = response.body.getReader(), decoder = new TextDecoder();
                const frames = new FlowSSEDecoder(raw => { if (asRecord(raw)?.['realtime-disabled'] === true) {
                    permanent = true;
                    setLiveState('disabled');
                    controller?.abort();
                    return;
                } const state = parseFlowEvent(raw); if (!state)
                    throw new Error('Invalid summary'); accept(state); failures = 0; if (!stopped)
                    setLiveState('live'); }, 256 * 1024);
                try {
                    for (;;) {
                        const item = await reader.read();
                        if (item.done)
                            break;
                        resetWatchdog();
                        frames.feed(decoder.decode(item.value, { stream: true }));
                    }
                }
                finally {
                    await reader.cancel().catch(() => { });
                    reader.releaseLock();
                }
            }
            catch { /* Only observation reconnects; never retry a model request. */ }
            finally {
                clearWatchdog();
            }
            if (stopped || permanent)
                return;
            failures++;
            setLiveState('reconnecting');
            retry = setTimeout(() => { void connect(); }, Math.min(10000, 1000 * 2 ** Math.min(failures, 3)));
        };
        void connect();
        return () => { stopped = true; controller?.abort(); clearWatchdog(); if (retry)
            clearTimeout(retry); };
    }, [apiBase, managementKey, connectionStatus, ready, enabled, interval, live, visible, revision]);
    return { support, refresh: () => setRevision(v => v + 1), live, setLive, liveState, history };
}
