/**
 * OAuth 相关类型
 * 基于原项目 src/modules/oauth.js
 */

// OAuth 提供商类型
export type OAuthProvider =
  | 'codex'
  | 'anthropic'
  | 'antigravity'
  | 'gemini-cli'
  | 'kimi';

// OAuth 流程状态
export interface OAuthFlow {
  provider: OAuthProvider;
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: Date;
  interval: number;
  status: 'pending' | 'authorized' | 'expired' | 'error';
}

// OAuth 配置
export interface OAuthConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

// OAuth 排除模型列表
export interface OAuthExcludedModels {
  models: string[];
}

// OAuth 模型策略（LTS oauth-model-policy）：可开关的黑白名单
export interface OAuthModelPolicyList {
  enabled: boolean;
  models: string[];
}

export interface OAuthModelPolicyEntry {
  allowlist?: OAuthModelPolicyList | null;
  denylist?: OAuthModelPolicyList | null;
}

export type OAuthModelPolicy = Record<string, OAuthModelPolicyEntry>;

// 账号认证文件内的 model_policy 对象，结构与渠道条目一致
export type AuthFileModelPolicy = OAuthModelPolicyEntry;

// 模型策略预览（GET /auth-files/models/policy-preview）
export interface ModelPolicyEvaluation {
  model_id: string;
  allowed: boolean;
  layer?: string;
  reason?: string;
}

export interface ModelPolicyPreview {
  auth_id: string;
  provider: string;
  catalog_status: string;
  evaluations: ModelPolicyEvaluation[];
}

// OAuth 模型别名
export interface OAuthModelAliasEntry {
  name: string;
  alias: string;
  fork?: boolean;
  forceMapping?: boolean;
}

export type OAuthModelAlias = Record<string, OAuthModelAliasEntry[]>;
