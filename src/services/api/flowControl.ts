/**
 * Flow Control management API client
 *
 * Central listing of the read-only /v0/management/flow-control* endpoints.
 * Required by docs/lts/panel-feature-contracts.yaml (local-flow-control-config):
 * every core_endpoints entry must be registered in a service API client file.
 * The paths below are relative to the management API base configured on the
 * shared ApiClient instance.
 */
import { apiClient } from './client';

export const FLOW_CONTROL_ENDPOINTS = {
  /** Capability, effective policy, catalogs and summary. */
  status: '/flow-control',
  /** Shared rate-limited SSE summary stream (native fetch, not axios). */
  events: '/flow-control/events',
  /** Single-rule explanation via the Core matcher (unused by views yet). */
  explain: '/flow-control/explain',
  /** Lightweight on-demand summary (unused by views yet). */
  summary: '/flow-control/summary',
  /** Bounded, manually paged wait-queue details. */
  details: '/flow-control/details',
  /** Batch draft/policy explanation and cross-coverage matrix. */
  preview: '/flow-control/preview',
  /** Migration suggestions from legacy policies; never writes config. */
  migrationPreview: '/flow-control/migration-preview',
} as const;

export const flowControlApi = {
  getStatus: () => apiClient.get<unknown>(FLOW_CONTROL_ENDPOINTS.status),
  getSummary: () => apiClient.get<unknown>(FLOW_CONTROL_ENDPOINTS.summary),
  getDetails: (query: string) => apiClient.get<unknown>(`${FLOW_CONTROL_ENDPOINTS.details}?${query}`),
  postPreview: (body: unknown) => apiClient.post<unknown>(FLOW_CONTROL_ENDPOINTS.preview, body),
  postMigrationPreview: (body: unknown) =>
    apiClient.post<unknown>(FLOW_CONTROL_ENDPOINTS.migrationPreview, body),
};
