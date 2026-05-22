import type { CodexRemoteCloudConnectEnvironment } from '@/services/api';

export type CodexRemoteCloudConnectCleanupAdviceLevel = 'keep' | 'cleanable' | 'caution';

export type CodexRemoteCloudConnectCleanupAdviceReason =
  | 'online'
  | 'busy'
  | 'hasLastSeen'
  | 'fieldComplete'
  | 'sameHostLatest'
  | 'sameHostOlder'
  | 'skeletonRecord'
  | 'missingLastSeen'
  | 'uniqueHost'
  | 'offlineComplete'
  | 'olderVersion';

export interface CodexRemoteCloudConnectCleanupAdvice {
  level: CodexRemoteCloudConnectCleanupAdviceLevel;
  reasons: CodexRemoteCloudConnectCleanupAdviceReason[];
}

export interface CodexRemoteCloudConnectEnvironmentView {
  environment: CodexRemoteCloudConnectEnvironment;
  groupKey: string;
  groupLabel: string;
  advice: CodexRemoteCloudConnectCleanupAdvice;
  completenessScore: number;
  lastSeenTimestamp: number;
  sortScore: number;
}

export interface CodexRemoteCloudConnectEnvironmentGroupSummary {
  total: number;
  online: number;
  busy: number;
  keep: number;
  cleanable: number;
  caution: number;
}

export interface CodexRemoteCloudConnectEnvironmentGroup {
  key: string;
  label: string;
  environments: CodexRemoteCloudConnectEnvironmentView[];
  summary: CodexRemoteCloudConnectEnvironmentGroupSummary;
}

export interface CodexRemoteCloudConnectEnvironmentSummary {
  total: number;
  hostCount: number;
  online: number;
  busy: number;
  keep: number;
  cleanable: number;
  caution: number;
  signature: string;
}

export interface CodexRemoteCloudConnectEnvironmentViewModel {
  environments: CodexRemoteCloudConnectEnvironmentView[];
  groups: CodexRemoteCloudConnectEnvironmentGroup[];
  summary: CodexRemoteCloudConnectEnvironmentSummary;
}

export type CodexRemoteCloudConnectEnvironmentLastAction =
  | {
      type: 'deleteSuccess';
      environmentName: string;
      envId: string;
    }
  | {
      type: 'recheckRunning';
      environmentName: string;
      envId: string;
    }
  | {
      type: 'recheckStable';
      environmentName: string;
      envId: string;
      total: number;
    }
  | {
      type: 'recheckChanged';
      environmentName: string;
      envId: string;
      total: number;
    }
  | {
      type: 'recheckFailed';
      environmentName: string;
      envId: string;
      message: string;
    };

const identityFields: Array<keyof CodexRemoteCloudConnectEnvironment> = [
  'installationId',
  'originator',
  'clientName',
  'clientVersion',
  'osVersion',
  'terminal',
  'appServerVersion',
  'clientType',
];

const normalizeComparableVersion = (version: string | null): number[] => {
  if (!version) return [];
  const matches = version.match(/\d+/g);
  return matches ? matches.map((part) => Number(part)) : [];
};

const compareVersion = (left: string | null, right: string | null): number => {
  const leftParts = normalizeComparableVersion(left);
  const rightParts = normalizeComparableVersion(right);
  const max = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < max; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const resolveLastSeenTimestamp = (value: string | null): number => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const resolveCompletenessScore = (environment: CodexRemoteCloudConnectEnvironment): number =>
  identityFields.reduce((score, field) => score + (environment[field] ? 1 : 0), 0);

const resolveGroupKey = (environment: CodexRemoteCloudConnectEnvironment): string =>
  environment.hostName || environment.displayName || environment.name || environment.envId;

const resolveSortScore = (
  environment: CodexRemoteCloudConnectEnvironment,
  completenessScore: number,
  lastSeenTimestamp: number
): number => {
  const onlineScore = environment.online === true ? 1_000_000_000 : 0;
  const busyScore = environment.busy === true ? 100_000_000 : 0;
  const lastSeenScore = Math.min(lastSeenTimestamp, 9_999_999_999_999) / 100_000;
  return onlineScore + busyScore + lastSeenScore + completenessScore * 1_000;
};

const isSkeletonRecord = (environment: CodexRemoteCloudConnectEnvironment): boolean =>
  !environment.installationId &&
  !environment.originator &&
  !environment.clientName &&
  !environment.clientVersion &&
  !environment.osVersion;

const hasCompleteIdentity = (completenessScore: number): boolean =>
  completenessScore >= Math.ceil(identityFields.length * 0.65);

const createAdvice = (
  view: Omit<CodexRemoteCloudConnectEnvironmentView, 'advice'>,
  group: Array<Omit<CodexRemoteCloudConnectEnvironmentView, 'advice'>>,
  newestEnvId: string | null
): CodexRemoteCloudConnectCleanupAdvice => {
  const { environment, completenessScore, lastSeenTimestamp } = view;
  const reasons: CodexRemoteCloudConnectCleanupAdviceReason[] = [];
  const sameHostHasMultiple = group.length > 1;
  const sameHostLatest = sameHostHasMultiple && environment.envId === newestEnvId;
  const sameHostOlder = sameHostHasMultiple && environment.envId !== newestEnvId;
  const skeletonRecord = isSkeletonRecord(environment);
  const fieldComplete = hasCompleteIdentity(completenessScore);
  const missingLastSeen = lastSeenTimestamp <= 0;
  const isOlderVersion =
    sameHostOlder &&
    group.some(
      (item) =>
        item.environment.envId !== environment.envId &&
        compareVersion(item.environment.appServerVersion, environment.appServerVersion) > 0
    );

  if (environment.online === true) reasons.push('online');
  if (environment.busy === true) reasons.push('busy');
  if (lastSeenTimestamp > 0) reasons.push('hasLastSeen');
  if (fieldComplete) reasons.push('fieldComplete');
  if (sameHostLatest) reasons.push('sameHostLatest');
  if (sameHostOlder) reasons.push('sameHostOlder');
  if (skeletonRecord) reasons.push('skeletonRecord');
  if (missingLastSeen) reasons.push('missingLastSeen');
  if (!sameHostHasMultiple) reasons.push('uniqueHost');
  if (environment.online === false && fieldComplete) reasons.push('offlineComplete');
  if (isOlderVersion) reasons.push('olderVersion');

  if (environment.online === true || environment.busy === true) {
    return { level: 'keep', reasons };
  }

  if (sameHostOlder && (skeletonRecord || missingLastSeen || isOlderVersion)) {
    return { level: 'cleanable', reasons };
  }

  if (!sameHostHasMultiple) {
    return { level: 'caution', reasons };
  }

  if (sameHostLatest && (fieldComplete || lastSeenTimestamp > 0)) {
    return { level: 'keep', reasons };
  }

  return { level: 'caution', reasons };
};

const summarizeGroup = (
  environments: CodexRemoteCloudConnectEnvironmentView[]
): CodexRemoteCloudConnectEnvironmentGroupSummary => ({
  total: environments.length,
  online: environments.filter((item) => item.environment.online === true).length,
  busy: environments.filter((item) => item.environment.busy === true).length,
  keep: environments.filter((item) => item.advice.level === 'keep').length,
  cleanable: environments.filter((item) => item.advice.level === 'cleanable').length,
  caution: environments.filter((item) => item.advice.level === 'caution').length,
});

export const createCodexRemoteCloudConnectEnvironmentViewModel = (
  environments: CodexRemoteCloudConnectEnvironment[]
): CodexRemoteCloudConnectEnvironmentViewModel => {
  const grouped = new Map<string, Array<Omit<CodexRemoteCloudConnectEnvironmentView, 'advice'>>>();

  for (const environment of environments) {
    const groupKey = resolveGroupKey(environment);
    const completenessScore = resolveCompletenessScore(environment);
    const lastSeenTimestamp = resolveLastSeenTimestamp(environment.lastSeenAt);
    const viewWithoutAdvice = {
      environment,
      groupKey,
      groupLabel: groupKey,
      completenessScore,
      lastSeenTimestamp,
      sortScore: resolveSortScore(environment, completenessScore, lastSeenTimestamp),
    };
    const group = grouped.get(groupKey) ?? [];
    group.push(viewWithoutAdvice);
    grouped.set(groupKey, group);
  }

  const groups: CodexRemoteCloudConnectEnvironmentGroup[] = Array.from(grouped.entries()).map(
    ([key, rawGroup]) => {
      const sortedRawGroup = [...rawGroup].sort((left, right) => {
        const scoreDiff = right.sortScore - left.sortScore;
        if (scoreDiff !== 0) return scoreDiff;
        const versionDiff = compareVersion(
          right.environment.appServerVersion,
          left.environment.appServerVersion
        );
        if (versionDiff !== 0) return versionDiff;
        return right.environment.envId.localeCompare(left.environment.envId);
      });
      const newestEnvId = sortedRawGroup[0]?.environment.envId ?? null;
      const views = sortedRawGroup.map((item) => ({
        ...item,
        advice: createAdvice(item, sortedRawGroup, newestEnvId),
      }));
      return {
        key,
        label: key,
        environments: views,
        summary: summarizeGroup(views),
      };
    }
  );

  groups.sort((left, right) => {
    const onlineDiff = right.summary.online - left.summary.online;
    if (onlineDiff !== 0) return onlineDiff;
    const cleanableDiff = right.summary.cleanable - left.summary.cleanable;
    if (cleanableDiff !== 0) return cleanableDiff;
    return left.label.localeCompare(right.label);
  });

  const sortedEnvironments = groups.flatMap((group) => group.environments);
  const signature = sortedEnvironments
    .map((item) => `${item.environment.envId}:${item.advice.level}`)
    .sort()
    .join('|');

  return {
    environments: sortedEnvironments,
    groups,
    summary: {
      total: sortedEnvironments.length,
      hostCount: groups.length,
      online: sortedEnvironments.filter((item) => item.environment.online === true).length,
      busy: sortedEnvironments.filter((item) => item.environment.busy === true).length,
      keep: sortedEnvironments.filter((item) => item.advice.level === 'keep').length,
      cleanable: sortedEnvironments.filter((item) => item.advice.level === 'cleanable').length,
      caution: sortedEnvironments.filter((item) => item.advice.level === 'caution').length,
      signature,
    },
  };
};

export const createCodexRemoteCloudConnectEnvironmentSummary = (
  environments: CodexRemoteCloudConnectEnvironment[]
): CodexRemoteCloudConnectEnvironmentSummary =>
  createCodexRemoteCloudConnectEnvironmentViewModel(environments).summary;

export const areCodexRemoteCloudConnectEnvironmentSummariesEqual = (
  left: CodexRemoteCloudConnectEnvironmentSummary | null,
  right: CodexRemoteCloudConnectEnvironmentSummary | null
): boolean => {
  if (!left || !right) return false;
  return (
    left.total === right.total &&
    left.hostCount === right.hostCount &&
    left.online === right.online &&
    left.busy === right.busy &&
    left.keep === right.keep &&
    left.cleanable === right.cleanable &&
    left.caution === right.caution &&
    left.signature === right.signature
  );
};
