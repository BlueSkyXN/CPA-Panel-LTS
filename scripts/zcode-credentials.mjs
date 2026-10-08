#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REGIONS = Object.freeze({
  bigmodel: { business: 'https://bigmodel.cn', model: 'https://open.bigmodel.cn' },
  zai: { business: 'https://api.z.ai', model: 'https://api.z.ai' },
});
const SALT = 'WD_CLIENT_SIGN_KDF_SALT';
const MAX_FILE = 8 * 1024 * 1024;
const MAX_RESPONSE = 2 * 1024 * 1024;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const failure = (code) => Object.assign(new Error(code), { safeCode: code });
const errorCode = (error) => error?.safeCode || 'operation_failed';

function parseArgs(args) {
  const options = { directories: [], remote: false, v4: false, allProjects: false };
  const values = new Map([
    ['--data-dir', 'directories'],
    ['--app', 'app'],
    ['--client-version', 'clientVersion'],
    ['--session-id', 'sessionId'],
    ['--region', 'region'],
  ]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (values.has(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw failure('missing_option_value');
      const field = values.get(arg);
      if (field === 'directories') options.directories.push(path.resolve(value));
      else options[field] = value;
    } else if (arg === '--remote') options.remote = true;
    else if (arg === '--v4') options.v4 = true;
    else if (arg === '--all-projects') options.allProjects = true;
    else if (arg === '--self-test') options.selfTest = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw failure('unknown_option');
  }
  if (options.region && !Object.hasOwn(REGIONS, options.region)) throw failure('invalid_region');
  if (options.allProjects && !options.remote) throw failure('all_projects_requires_remote');
  if (options.clientVersion && !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(options.clientVersion)) {
    throw failure('invalid_client_version');
  }
  if (options.sessionId && !/^[\x21-\x7e]{1,256}$/.test(options.sessionId))
    throw failure('invalid_session_id');
  return options;
}

async function readJson(file) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE) throw failure('invalid_file_or_too_large');
    const bytes = Buffer.alloc(MAX_FILE + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_FILE) throw failure('file_too_large');
    let value;
    try {
      value = JSON.parse(bytes.subarray(0, length).toString('utf8'));
    } catch {
      throw failure('invalid_json');
    } finally {
      bytes.fill(0);
    }
    if (!record(value)) throw failure('expected_json_object');
    return { status: 'ok', value };
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'missing' : 'error', error: errorCode(error) };
  } finally {
    await handle?.close();
  }
}

function localCipherKey(env = process.env) {
  let username = 'unknown';
  try {
    username = os.userInfo().username;
  } catch {}
  return crypto
    .createHash('sha256')
    .update(
      env.ZCODE_CREDENTIAL_SECRET ||
        `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${username}`
    )
    .digest();
}

function decodeBase64(value, url = false) {
  const pattern = url ? /^[A-Za-z0-9_-]+={0,2}$/ : /^[A-Za-z0-9+/]+={0,2}$/;
  if (
    typeof value !== 'string' ||
    !pattern.test(value) ||
    value.replace(/=+$/, '').length % 4 === 1
  ) {
    throw failure('invalid_base64');
  }
  const bytes = Buffer.from(value, url ? 'base64url' : 'base64');
  if (
    bytes.toString(url ? 'base64url' : 'base64').replace(/=+$/, '') !== value.replace(/=+$/, '')
  ) {
    throw failure('invalid_base64');
  }
  return bytes;
}

function openGcm(key, iv, tag, ciphertext, aad) {
  let partial, final, plain;
  try {
    if (iv.length !== 12 || tag.length !== 16) throw failure('invalid_gcm_parameters');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    if (aad) decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    partial = decipher.update(ciphertext);
    final = decipher.final();
    plain = Buffer.concat([partial, final]);
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch {
    throw failure('decrypt_authentication_or_encoding_failed');
  } finally {
    partial?.fill(0);
    final?.fill(0);
    plain?.fill(0);
  }
}

function decryptValue(value, key) {
  if (typeof value !== 'string' || !value.startsWith('enc:')) return value;
  const match = /^enc:v1:([^.]*)\.([^.]*)\.([^.]*)$/.exec(value);
  if (!match) throw failure('unsupported_encryption_format');
  const [iv, tag, ciphertext] = match.slice(1).map((part) => decodeBase64(part, true));
  return openGcm(key, iv, tag, ciphertext);
}

function decryptTree(value, key, errors, pointer = '', depth = 0) {
  if (depth > 64) throw failure('json_nesting_too_deep');
  if (typeof value === 'string') {
    try {
      return decryptValue(value, key);
    } catch (error) {
      errors.push({ field: pointer, error: errorCode(error) });
      return { decryption_error: errorCode(error) };
    }
  }
  if (Array.isArray(value))
    return value.map((item, index) =>
      decryptTree(item, key, errors, `${pointer}/${index}`, depth + 1)
    );
  if (record(value))
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        decryptTree(
          item,
          key,
          errors,
          `${pointer}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`,
          depth + 1
        ),
      ])
    );
  return value;
}

function regionFor(provider, baseUrl) {
  let name = text(provider).toLowerCase();
  try {
    name = decodeURIComponent(name);
  } catch {}
  const named = name.includes('bigmodel')
    ? 'bigmodel'
    : /(?:^|[:/-])zai(?:$|[:/-])/.test(name)
      ? 'zai'
      : null;
  let endpointRegion = null;
  if (baseUrl) {
    try {
      const url = new URL(baseUrl);
      endpointRegion =
        Object.entries(REGIONS).find(([, config]) => url.origin === config.model)?.[0] || null;
      if (!endpointRegion || url.username || url.password)
        return { region: named, network_allowed: false };
    } catch {
      return { region: named, network_allowed: false };
    }
  }
  return {
    region: named || endpointRegion,
    network_allowed:
      Boolean(named || endpointRegion) && (!named || !endpointRegion || named === endpointRegion),
  };
}

function splitKey(value) {
  if (typeof value !== 'string' || !/^[^\s.\x00-\x1f\x7f]+\.[^\s.\x00-\x1f\x7f]+$/.test(value))
    return null;
  const [id, secret] = value.split('.');
  return { id, secret };
}

function isStartPlanProvider(value) {
  let provider = text(value).toLowerCase();
  try {
    provider = decodeURIComponent(provider);
  } catch {}
  return /(?:^|:)(?:bigmodel|zai)-start-plan(?::|$)/.test(provider);
}

function addCandidate(report, value, source, identity) {
  if (!text(value) || value.startsWith('enc:')) return;
  const apiKey = value.trim();
  let candidate = report.api_keys.find(
    (item) =>
      item.api_key === apiKey &&
      item.region === identity.region &&
      item.network_allowed === identity.network_allowed
  );
  if (!candidate) {
    const parts = splitKey(apiKey);
    candidate = {
      index: report.api_keys.length + 1,
      api_key: apiKey,
      key_id: parts?.id || null,
      key_secret: parts?.secret || null,
      ...identity,
      complete_key_format: Boolean(parts),
      sources: [],
    };
    report.api_keys.push(candidate);
  }
  candidate.sources.push(source);
}

function selectionFor(settings, region) {
  const current = settings.providerFamilyConnectionSelections?.[region];
  if (record(current)) return current;
  const legacy = settings.modelProviderFamilySelectedKeys?.[region];
  const prefix = `team-plan:builtin:${region}-coding-plan:`;
  if (typeof legacy === 'string' && legacy.startsWith(prefix)) {
    try {
      const parts = legacy.slice(prefix.length).split(':').map(decodeURIComponent);
      if (parts.length === 3 && parts.every(text))
        return {
          kind: 'team-coding-plan',
          productId: parts[0],
          organizationId: parts[1],
          projectId: parts[2],
        };
    } catch {}
  }
  return null;
}

async function findDirectories(options, report) {
  const settingsHome = process.env.ZCODE_DESKTOP_HOME_DIR || os.homedir();
  const settingsFile = path.join(settingsHome, '.zcode/v2/setting.json');
  const setting = await readJson(settingsFile);
  report.settings_source = { file: settingsFile, status: setting.status };
  if (setting.status === 'error')
    report.errors.push({ source: settingsFile, error: setting.error });
  report.desktop_settings = setting.value || {};
  // 桌面设置与凭据目录可以分开；显式指定当前数据目录仍需保留其套餐选择。
  report.desktop_data_directory = path.resolve(
    process.env.ZCODE_DATA_BASE_DIR || setting.value?.dataBaseDir || os.homedir(),
    '.zcode/v2'
  );
  if (options.directories.length) return [...new Set(options.directories)];
  const bases = [process.env.ZCODE_DATA_BASE_DIR, setting.value?.dataBaseDir, os.homedir()].filter(
    text
  );
  return [...new Set(bases.map((base) => path.resolve(base, '.zcode/v2')))];
}

async function readSource(directory, name, report) {
  const file = path.join(directory, name);
  const result = await readJson(file);
  report.files.push({ file, status: result.status });
  if (result.status === 'error') report.errors.push({ source: file, error: result.error });
  return result.value || {};
}

async function collectLocal(options, report) {
  const directories = await findDirectories(options, report);
  const key = localCipherKey();
  try {
    for (const directory of directories) {
      const credentialErrors = [];
      const raw = await readSource(directory, 'credentials.json', report);
      const credentials = decryptTree(raw, key, credentialErrors);
      report.errors.push(
        ...credentialErrors.map((error) => ({
          source: path.join(directory, 'credentials.json'),
          ...error,
        }))
      );
      const settings = await readSource(directory, 'setting.json', report);
      const telemetry = await readSource(directory, 'telemetry-state.json', report);
      const settingsForSource = Object.keys(settings).length
        ? settings
        : directory === report.desktop_data_directory
          ? report.desktop_settings || {}
          : {};
      const deviceErrors = [];
      const device = decryptTree(telemetry.deviceMid ?? null, key, deviceErrors, '/deviceMid');
      report.errors.push(
        ...deviceErrors.map((error) => ({
          source: path.join(directory, 'telemetry-state.json'),
          ...error,
        }))
      );
      const context = {
        directory,
        credentials,
        device_id: text(device) || null,
        provider_family: settingsForSource.providerFamilyDomain || null,
        selections: Object.fromEntries(
          Object.keys(REGIONS).map((region) => [region, selectionFor(settingsForSource, region)])
        ),
      };
      report.local_sources.push(context);
      for (const [field, value] of Object.entries(credentials)) {
        if (
          field.startsWith('account-provider:') &&
          field.endsWith(':api-key') &&
          !isStartPlanProvider(field)
        ) {
          addCandidate(
            report,
            value,
            {
              file: path.join(directory, 'credentials.json'),
              field,
              plan_hint: field.includes('team')
                ? 'team_name_only_not_verified'
                : 'account_key_not_verified',
            },
            regionFor(field)
          );
        }
      }
      for (const name of ['config.json', 'provider_config.json']) {
        const errors = [];
        const config = decryptTree(await readSource(directory, name, report), key, errors);
        report.errors.push(
          ...errors.map((error) => ({ source: path.join(directory, name), ...error }))
        );
        if (name === 'config.json') {
          for (const [provider, entry] of Object.entries(
            record(config.provider) ? config.provider : {}
          )) {
            if (!record(entry) || isStartPlanProvider(provider)) continue;
            const identity = regionFor(provider, entry.options?.baseURL || entry.api);
            if (identity.region)
              addCandidate(
                report,
                entry.options?.apiKey,
                {
                  file: path.join(directory, name),
                  field: ['provider', provider, 'options', 'apiKey'],
                  plan_hint: 'legacy_not_verified',
                },
                identity
              );
          }
        } else {
          const rules =
            config.providerConfigRules?.providerRules ||
            config.config?.providerConfigRules?.providerRules;
          for (const entry of Array.isArray(rules) ? rules : []) {
            if (!record(entry) || isStartPlanProvider(entry.providerId)) continue;
            const identity = regionFor(entry.providerId, entry.config?.api?.baseUrl);
            if (identity.region)
              addCandidate(
                report,
                entry.config?.access?.apiKey,
                {
                  file: path.join(directory, name),
                  field: [
                    'providerConfigRules',
                    'providerRules',
                    entry.providerId,
                    'config',
                    'access',
                    'apiKey',
                  ],
                  plan_hint: 'configured_not_verified',
                },
                identity
              );
          }
        }
      }
    }
  } finally {
    key.fill(0);
  }
  delete report.desktop_settings;
  delete report.desktop_data_directory;
}

async function detectVersion(options) {
  if (options.clientVersion) return { value: options.clientVersion, source: 'explicit' };
  if (process.platform !== 'darwin') return { value: null, source: 'use_--client-version' };
  const apps = options.app
    ? [options.app]
    : [
        '/Applications/ZCode.app',
        '/Applications/ZCodeself.app',
        path.join(os.homedir(), 'Applications/ZCode.app'),
        path.join(os.homedir(), 'Applications/ZCodeself.app'),
      ];
  for (const app of apps) {
    const file = path.join(app, 'Contents/Info.plist');
    try {
      await fs.access(file);
    } catch {
      continue;
    }
    const result = spawnSync(
      '/usr/bin/plutil',
      ['-extract', 'CFBundleShortVersionString', 'raw', '-expect', 'string', file],
      { encoding: 'utf8', timeout: 3000, maxBuffer: 65536 }
    );
    const value = text(result.stdout);
    if (result.status === 0 && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value))
      return { value, source: file };
  }
  return { value: null, source: 'use_--app_or_--client-version' };
}

async function requestJson(fetchImpl, region, kind, route, authorization, options = {}) {
  const origin = REGIONS[region]?.[kind];
  if (!origin || !route.startsWith('/') || route.startsWith('//'))
    throw failure('untrusted_endpoint');
  const url = new URL(route, origin);
  if (url.origin !== origin || url.username || url.password) throw failure('untrusted_endpoint');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let reader;
  try {
    const response = await fetchImpl(url.href, {
      method: options.body ? 'POST' : 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        ...options.headers,
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (response.status !== 200) throw failure(`http_${Number(response.status) || 'invalid'}`);
    if (!response.body || Number(response.headers.get('content-length')) > MAX_RESPONSE)
      throw failure('invalid_response_size');
    reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE) throw failure('response_too_large');
      chunks.push(Buffer.from(value));
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw failure('invalid_remote_json');
    }
    if (!record(body)) throw failure('invalid_remote_schema');
    if (
      body.success === false ||
      (body.code !== undefined && ![0, 200, '0', '200'].includes(body.code))
    )
      throw failure('remote_rejected');
    return body;
  } catch (error) {
    throw error.safeCode
      ? error
      : failure(controller.signal.aborted ? 'request_timeout' : 'network_or_redirect_failed');
  } finally {
    await reader?.cancel().catch(() => {});
    clearTimeout(timer);
  }
}

function projectsFrom(customer) {
  const projects = [];
  for (const organization of Array.isArray(customer?.organizations) ? customer.organizations : []) {
    if (!text(organization?.organizationId)) continue;
    for (const project of Array.isArray(organization.projects) ? organization.projects : []) {
      if (text(project?.projectId))
        projects.push({
          organizationId: organization.organizationId,
          organizationName: organization.organizationName || null,
          projectId: project.projectId,
          projectName: project.projectName || null,
          projectType: String(project.projectType ?? ''),
        });
    }
  }
  return projects;
}

async function collectRemote(options, report, fetchImpl) {
  const processed = new Set();
  for (const source of report.local_sources) {
    for (const region of Object.keys(REGIONS)) {
      if (options.region && options.region !== region) continue;
      const token = text(source.credentials[`oauth:${region}:access_token`]);
      if (!token) continue;
      if (region === 'bigmodel' && token === text(source.credentials.zcodejwttoken)) {
        report.errors.push({ source: source.directory, region, error: 'oauth_token_is_zcode_jwt' });
        continue;
      }
      const selection = source.selections[region];
      // ZCode uses Bearer for ZAI personal lookup, but raw OAuth for team lookup.
      const modes =
        region === 'zai'
          ? [
              'personal',
              ...(options.allProjects || selection?.kind === 'team-coding-plan' ? ['team'] : []),
            ]
          : ['both'];
      for (const mode of modes) {
        const authorization =
          region === 'zai' && mode === 'personal'
            ? `Bearer ${token.replace(/^Bearer\s+/i, '')}`
            : token;
        const scope = JSON.stringify([region, authorization, selection, mode]);
        if (processed.has(scope)) continue;
        processed.add(scope);
        const remote = {
          directory: source.directory,
          region,
          lookup: mode,
          status: 'pending',
          projects: [],
        };
        report.remote.push(remote);
        try {
          const customer = await requestJson(
            fetchImpl,
            region,
            'business',
            '/api/biz/customer/getCustomerInfo',
            authorization
          );
          const projects = projectsFrom(customer.data);
          if (
            mode !== 'personal' &&
            selection?.kind === 'team-coding-plan' &&
            !projects.some(
              (p) =>
                p.organizationId === selection.organizationId && p.projectId === selection.projectId
            )
          ) {
            report.errors.push({
              source: source.directory,
              region,
              error: 'selected_team_project_not_accessible',
            });
          }
          const teamProject = (project) =>
            project.projectType === '2' ||
            (selection?.kind === 'team-coding-plan' &&
              project.organizationId === selection.organizationId &&
              project.projectId === selection.projectId);
          const targets = projects.filter((project) => {
            const isTeam = teamProject(project);
            if ((mode === 'personal' && isTeam) || (mode === 'team' && !isTeam)) return false;
            return (
              !isTeam ||
              options.allProjects ||
              (selection?.kind === 'team-coding-plan' &&
                project.organizationId === selection.organizationId &&
                project.projectId === selection.projectId)
            );
          });
          if (!targets.length)
            report.errors.push({ source: source.directory, region, error: 'no_matching_projects' });
          for (const project of targets) {
            const isTeam = teamProject(project);
            const projectReport = {
              ...project,
              plan: isTeam ? 'team' : 'personal',
              keys_found: 0,
              status: 'pending',
            };
            remote.projects.push(projectReport);
            const base = `/api/biz/v1/organization/${encodeURIComponent(project.organizationId)}/projects/${encodeURIComponent(project.projectId)}/api_keys`;
            const headers = isTeam
              ? {
                  'bigmodel-organization': project.organizationId,
                  'bigmodel-project': project.projectId,
                }
              : {};
            try {
              const listing = await requestJson(
                fetchImpl,
                region,
                'business',
                base,
                authorization,
                { headers }
              );
              if (!Array.isArray(listing.data)) throw failure('invalid_project_keys_schema');
              const keys = listing.data.filter(
                (item) =>
                  record(item) &&
                  text(item.apiKey) &&
                  (isTeam
                    ? item.name === 'zcode-team-api-key' && item.keyType === 2
                    : item.name === 'zcode-api-key')
              );
              if (!keys.length)
                report.errors.push({
                  source: source.directory,
                  region,
                  project_id: project.projectId,
                  error: 'no_existing_zcode_key',
                });
              for (const item of keys) {
                try {
                  const copied = await requestJson(
                    fetchImpl,
                    region,
                    'business',
                    `${base}/copy/${encodeURIComponent(item.apiKey)}`,
                    authorization,
                    { headers }
                  );
                  const secret = text(copied.data?.secretKey);
                  if (!secret) throw failure('missing_project_key_secret');
                  addCandidate(
                    report,
                    `${item.apiKey}.${secret}`,
                    {
                      kind: 'remote_project',
                      directory: source.directory,
                      organization_id: project.organizationId,
                      project_id: project.projectId,
                      name: item.name,
                      key_type: item.keyType ?? null,
                      plan_hint:
                        item.name === 'zcode-team-api-key' && item.keyType === 2
                          ? 'team_project_key'
                          : 'personal_project_key',
                      billing_verified: false,
                    },
                    { region, network_allowed: true }
                  );
                  projectReport.keys_found++;
                } catch (error) {
                  report.errors.push({
                    source: source.directory,
                    region,
                    project_id: project.projectId,
                    error: errorCode(error),
                  });
                }
              }
              projectReport.status = keys.length
                ? projectReport.keys_found === keys.length
                  ? 'ok'
                  : 'partial'
                : 'no_existing_zcode_key';
            } catch (error) {
              projectReport.status = 'error';
              report.errors.push({
                source: source.directory,
                region,
                project_id: project.projectId,
                error: errorCode(error),
              });
            }
          }
          remote.status =
            remote.projects.length && remote.projects.every((project) => project.status === 'ok')
              ? 'completed'
              : 'partial';
        } catch (error) {
          remote.status = 'error';
          report.errors.push({ source: source.directory, region, error: errorCode(error) });
        }
      }
    }
  }
  if (!report.remote.length) report.errors.push({ error: 'no_usable_oauth_for_remote_lookup' });
}

function derive(secret, info) {
  return Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from(SALT), Buffer.from(info), 32)
  );
}

function signingInputs(candidate) {
  const parts = splitKey(candidate.api_key);
  if (!parts) return { status: 'incomplete_api_key' };
  const hmacKey = derive(parts.secret, 'getSignKey_hmac');
  const decryptKey = derive(parts.secret, 'ed25519_priv');
  try {
    return {
      status: 'local_material_ready',
      api_key_id: parts.id,
      api_key_secret: parts.secret,
      hkdf: { hash: 'SHA-256', salt: SALT, output_bytes: 32 },
      handshake_hmac_key_base64: hmacKey.toString('base64'),
      private_cipher_aes_key_base64: decryptKey.toString('base64'),
      handshake_url: candidate.region
        ? `${REGIONS[candidate.region].model}/api/paas/c1f3a7e2/v2/client`
        : null,
    };
  } finally {
    hmacKey.fill(0);
    decryptKey.fill(0);
  }
}

function proofOfWork(id, session, timestamp) {
  const seed = crypto
    .createHash('sha256')
    .update(`${id}\nzcode\n${session}\n${timestamp}`)
    .digest('hex')
    .slice(0, 32);
  const prefix = crypto.randomBytes(12).toString('hex');
  for (let counter = 0; counter < 1_000_000; counter++) {
    const nonce = prefix + counter.toString(16).padStart(8, '0');
    if (crypto.createHash('sha256').update(`${seed}\n${nonce}`).digest()[0] === 0)
      return { seed, bits: 8, nonce };
  }
  throw failure('proof_of_work_exhausted');
}

async function collectV4(candidate, version, session, fetchImpl) {
  const { id, secret } = splitKey(candidate.api_key);
  const hmacKey = derive(secret, 'getSignKey_hmac');
  const decryptKey = derive(secret, 'ed25519_priv');
  let der;
  try {
    const ts = String(Date.now()),
      nonce = crypto.randomBytes(16).toString('hex');
    const handshakeMessage = `get_sign_key\n${id}\n${ts}\n${nonce}`;
    const payload = {
      apiKey: candidate.api_key,
      nonce,
      sig: crypto.createHmac('sha256', hmacKey).update(handshakeMessage).digest('base64'),
      ts,
    };
    const response = await requestJson(
      fetchImpl,
      candidate.region,
      'model',
      '/api/paas/c1f3a7e2/v2/client',
      candidate.api_key,
      { body: payload }
    );
    if (response.code !== 200) throw failure('invalid_handshake_code');
    const encrypted = decodeBase64(response.data?.privateCipher);
    if (encrypted.length < 29) throw failure('invalid_private_cipher');
    const plain = openGcm(
      decryptKey,
      encrypted.subarray(0, 12),
      encrypted.subarray(-16),
      encrypted.subarray(12, -16),
      Buffer.from(id)
    );
    der = decodeBase64(plain);
    let privateKey;
    try {
      privateKey = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    } catch {
      throw failure('invalid_signing_private_key');
    }
    if (privateKey.asymmetricKeyType !== 'ed25519') throw failure('unexpected_signing_key_type');
    const timestamp = String(Date.now()),
      requestNonce = crypto.randomBytes(16).toString('hex');
    const message = `${id}\n${timestamp}\n${version}\n${session}\n${requestNonce}`;
    const proof = proofOfWork(id, session, timestamp);
    return {
      ...candidate.v4,
      status: 'handshake_succeeded_example_generated',
      handshake_request: payload,
      handshake_message: handshakeMessage,
      private_cipher: response.data.privateCipher,
      private_key_pkcs8_base64: der.toString('base64'),
      private_key_pem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
      public_key_pem: crypto.createPublicKey(privateKey).export({ format: 'pem', type: 'spki' }),
      example_only_not_sent_to_model: true,
      sample_generated_at: new Date().toISOString(),
      signed_message: message,
      proof_of_work: proof,
      headers: {
        'X-Session-Id': session,
        'X-Client-Ts': timestamp,
        'X-Client-Version': version,
        'X-Client-Nonce': requestNonce,
        'X-App-Id': 'zcode',
        'X-Client-Pow': proof.nonce,
        'X-Client-Sig': crypto.sign(null, Buffer.from(message), privateKey).toString('base64'),
      },
    };
  } finally {
    hmacKey.fill(0);
    decryptKey.fill(0);
    der?.fill(0);
  }
}

async function collect(options, fetchImpl = globalThis.fetch) {
  const report = {
    format_version: 1,
    generated_at: new Date().toISOString(),
    plaintext_secrets: true,
    files: [],
    local_sources: [],
    api_keys: [],
    remote: [],
    errors: [],
  };
  await collectLocal(options, report);
  report.client_version = await detectVersion(options);
  report.identity = {
    platform: `${os.platform()}-${os.arch()}`,
    os_category:
      os.platform() === 'darwin' ? 'macos' : os.platform() === 'win32' ? 'windows' : 'linux',
    os_version: os.release(),
    language: Intl.DateTimeFormat().resolvedOptions().locale,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    app_id: 'zcode',
    session_id: options.sessionId || crypto.randomUUID(),
    session_id_source: options.sessionId ? 'explicit' : 'generated_example_not_existing_session',
  };
  if (options.remote) await collectRemote(options, report, fetchImpl);
  for (const candidate of report.api_keys) {
    candidate.v4 = signingInputs(candidate);
    if (!options.v4) continue;
    if (
      !candidate.complete_key_format ||
      !candidate.network_allowed ||
      (options.region && candidate.region !== options.region)
    ) {
      candidate.v4.network_status = 'skipped_incomplete_untrusted_or_region_filter';
      continue;
    }
    if (!report.client_version.value) {
      candidate.v4.network_status = 'skipped_missing_client_version';
      report.errors.push({ candidate: candidate.index, error: 'v4_requires_client_version' });
      continue;
    }
    try {
      candidate.v4 = await collectV4(
        candidate,
        report.client_version.value,
        report.identity.session_id,
        fetchImpl
      );
    } catch (error) {
      candidate.v4.network_status = 'failed';
      report.errors.push({ candidate: candidate.index, error: errorCode(error) });
    }
  }
  if (!report.api_keys.length) report.errors.push({ error: 'no_api_keys_found' });
  report.summary = {
    api_keys: report.api_keys.length,
    errors: report.errors.length,
    remote_lookup_requested: options.remote,
    v4_handshake_requested: options.v4,
    model_requests_sent: 0,
    source_files_modified: false,
    keys_created: false,
  };
  return report;
}

async function selfTest() {
  const { default: assert } = await import('node:assert/strict');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zcode-credentials-synthetic-'));
  const previousDesktopHome = process.env.ZCODE_DESKTOP_HOME_DIR;
  const desktopHome = path.join(directory, 'desktop-home');
  const desktopSettingsFile = path.join(desktopHome, '.zcode/v2/setting.json');
  await fs.mkdir(path.dirname(desktopSettingsFile), { recursive: true });
  process.env.ZCODE_DESKTOP_HOME_DIR = desktopHome;
  let count = 0;
  const test = async (name, callback) => {
    await callback();
    count++;
    console.log(`PASS ${name}`);
  };
  const seal = (value, key, aad) => {
    const iv = crypto.randomBytes(12),
      cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    if (aad) cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
    return { iv, tag: cipher.getAuthTag(), ciphertext };
  };
  const key = localCipherKey();
  const encrypted = (value) => {
    const sealed = seal(value, key);
    return `enc:v1:${[sealed.iv, sealed.tag, sealed.ciphertext].map((part) => part.toString('base64url')).join('.')}`;
  };
  const write = (name, value) =>
    fs.writeFile(path.join(directory, name), JSON.stringify(value), { mode: 0o600 });
  const jsonResponse = (body) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  try {
    await test('argument validation', () => {
      assert.throws(() => parseArgs(['--region', 'unknown']));
      assert.throws(() => parseArgs(['--all-projects']));
      assert.throws(() => parseArgs(['--session-id', 'bad\nheader']));
      assert.throws(() => parseArgs(['--client-version', 'bad']));
      assert.equal(parseArgs(['--remote', '--v4']).v4, true);
    });
    await test('authenticated decryption and nested failure isolation', () => {
      const errors = [],
        invalid = encrypted('wrong-key');
      const other = crypto.randomBytes(32);
      assert.throws(() => decryptValue(invalid, other));
      other.fill(0);
      const decoded = decryptTree(
        {
          good: encrypted('synthetic.secret'),
          nested: [encrypted('synthetic-oauth')],
          bad: 'enc:v9:unknown',
          number: 2,
        },
        key,
        errors
      );
      assert.equal(decoded.good, 'synthetic.secret');
      assert.equal(decoded.nested[0], 'synthetic-oauth');
      assert.equal(errors.length, 1);
      assert.equal(decoded.number, 2);
      assert.throws(() => decodeBase64('not valid'));
    });
    await write('credentials.json', {
      'account-provider:coding-plan:account:bigmodel-team-coding-plan:account:synthetic:api-key':
        encrypted('personal.secret'),
      'account-provider:coding-plan:account:bigmodel-individual-coding-plan:account:synthetic:api-key':
        encrypted('personal.secret'),
      'oauth:bigmodel:access_token': encrypted('synthetic-oauth'),
      zcodejwttoken: encrypted('synthetic-jwt'),
    });
    await write('setting.json', {
      providerFamilyDomain: 'bigmodel',
      providerFamilyConnectionSelections: {
        bigmodel: {
          kind: 'team-coding-plan',
          productId: 'synthetic-product',
          organizationId: 'org',
          projectId: 'team',
        },
      },
    });
    await write('telemetry-state.json', { deviceMid: 'synthetic-device' });
    await write('config.json', {
      provider: {
        'builtin:bigmodel-coding-plan': { options: { apiKey: 'personal.secret' } },
        'builtin:zai-coding-plan': { options: { apiKey: 'zai.secret' } },
      },
    });
    await write('provider_config.json', {
      providerConfigRules: {
        providerRules: [
          {
            providerId: 'custom-bigmodel',
            config: {
              access: { type: 'api-key', apiKey: 'custom.secret' },
              api: { baseUrl: 'https://open.bigmodel.cn/api/anthropic' },
            },
          },
        ],
      },
    });
    const options = parseArgs(['--data-dir', directory, '--client-version', '3.14.3']);
    let local;
    await test('multi-source discovery, plaintext, deduplication and zero default network', async () => {
      local = await collect(options, () => {
        throw new Error('unexpected network');
      });
      assert.equal(local.api_keys.length, 3);
      assert.equal(local.api_keys[0].sources.length, 3);
      assert.equal(
        local.local_sources[0].credentials['oauth:bigmodel:access_token'],
        'synthetic-oauth'
      );
      assert.equal(local.local_sources[0].device_id, 'synthetic-device');
      assert.equal(local.errors.length, 0);
      assert.equal(local.api_keys[0].v4.api_key_secret, 'secret');
    });
    await test('Start Plan credentials never enter Coding Plan candidates', async () => {
      const names = ['credentials.json', 'config.json', 'provider_config.json'];
      const originals = await Promise.all(
        names.map((name) => fs.readFile(path.join(directory, name), 'utf8'))
      );
      try {
        const credentials = JSON.parse(originals[0]);
        credentials[
          'account-provider:coding-plan:account:bigmodel-start-plan:account:synthetic:api-key'
        ] = encrypted('excluded.secret');
        await write(names[0], credentials);
        const config = JSON.parse(originals[1]);
        config.provider['builtin:bigmodel-start-plan'] = {
          options: { apiKey: 'synthetic.jwt.token' },
        };
        await write(names[1], config);
        const rules = JSON.parse(originals[2]);
        rules.providerConfigRules.providerRules.push({
          providerId: 'account:zai-start-plan',
          config: {
            access: { apiKey: 'excluded.secret' },
            api: { baseUrl: 'https://api.z.ai/api/anthropic' },
          },
        });
        await write(names[2], rules);
        const report = await collect(options);
        assert.deepEqual(
          report.api_keys.map((item) => item.api_key),
          local.api_keys.map((item) => item.api_key)
        );
        assert.equal(report.summary.api_keys, 3);
      } finally {
        await Promise.all(
          names.map((name, index) => fs.writeFile(path.join(directory, name), originals[index]))
        );
      }
    });
    await test('legacy selections and untrusted endpoint rejection', () => {
      assert.deepEqual(
        selectionFor(
          {
            modelProviderFamilySelectedKeys: {
              bigmodel: 'team-plan:builtin:bigmodel-coding-plan:prod:org:project',
            },
          },
          'bigmodel'
        ),
        { kind: 'team-coding-plan', productId: 'prod', organizationId: 'org', projectId: 'project' }
      );
      assert.equal(regionFor('bigmodel', 'https://evil.invalid').network_allowed, false);
      assert.equal(regionFor('bigmodel', 'https://api.z.ai').network_allowed, false);
    });
    const calls = [];
    const remoteFetch = async (url, init) => {
      calls.push({ url, method: init.method });
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Authorization, 'synthetic-oauth');
      assert.equal(init.method, 'GET');
      if (url.endsWith('/getCustomerInfo'))
        return jsonResponse({
          code: 0,
          data: {
            organizations: [
              {
                organizationId: 'org',
                projects: [
                  { projectId: 'personal', projectType: 1 },
                  { projectId: 'team', projectType: 2 },
                ],
              },
            ],
          },
        });
      const team = url.includes('/projects/team/');
      assert.equal(init.headers['bigmodel-organization'], team ? 'org' : undefined);
      if (url.endsWith('/api_keys'))
        return jsonResponse({
          code: 0,
          data: [
            {
              name: team ? 'zcode-team-api-key' : 'zcode-api-key',
              keyType: team ? 2 : 1,
              apiKey: team ? 'team-id' : 'personal-id',
            },
          ],
        });
      if (url.includes('/copy/'))
        return jsonResponse({ code: 0, data: { secretKey: 'remote-secret' } });
      throw new Error('unexpected mock endpoint');
    };
    await test('remote personal and selected team lookup without creation', async () => {
      const report = await collect({ ...options, remote: true }, remoteFetch);
      assert.equal(report.errors.length, 0);
      assert.equal(calls.length, 5);
      assert.ok(report.api_keys.some((item) => item.api_key === 'team-id.remote-secret'));
      assert.ok(report.api_keys.some((item) => item.api_key === 'personal-id.remote-secret'));
      assert.ok(calls.every((call) => call.method === 'GET'));
    });
    await test('explicit active data directory retains desktop team selection without leaking it to other directories', async () => {
      const dataBaseDir = path.join(directory, 'custom-data');
      const active = path.join(dataBaseDir, '.zcode/v2');
      const unrelated = path.join(directory, 'unrelated-data');
      for (const target of [active, unrelated]) {
        await fs.mkdir(target, { recursive: true });
        for (const name of ['credentials.json', 'telemetry-state.json'])
          await fs.copyFile(path.join(directory, name), path.join(target, name));
      }
      const setting = JSON.parse(await fs.readFile(path.join(directory, 'setting.json'), 'utf8'));
      await fs.writeFile(desktopSettingsFile, JSON.stringify({ ...setting, dataBaseDir }));
      try {
        const report = await collect(
          { ...options, directories: [active], remote: true },
          remoteFetch
        );
        assert.equal(report.local_sources[0].selections.bigmodel?.kind, 'team-coding-plan');
        assert.ok(report.api_keys.some((item) => item.api_key === 'team-id.remote-secret'));
        const isolated = await collect({ ...options, directories: [unrelated] });
        assert.equal(isolated.local_sources[0].selections.bigmodel, null);
      } finally {
        await fs.rm(desktopSettingsFile);
      }
    });
    await test('missing project keys never trigger creation or personal fallback', async () => {
      const report = await collect({ ...options, remote: true }, async (url, init) => {
        assert.equal(init.method, 'GET');
        return url.endsWith('/getCustomerInfo')
          ? remoteFetch(url, init)
          : jsonResponse({ code: 0, data: [] });
      });
      assert.equal(report.api_keys.length, local.api_keys.length);
      assert.ok(report.remote[0].projects.every((item) => item.status === 'no_existing_zcode_key'));
    });
    await test('team projects reject personal keys and all-projects is opt-in', async () => {
      const report = await collect({ ...options, remote: true }, async (url, init) => {
        if (url.includes('/projects/team/') && url.endsWith('/api_keys'))
          return jsonResponse({
            code: 0,
            data: [{ name: 'zcode-api-key', keyType: 1, apiKey: 'must-not-copy' }],
          });
        assert.ok(!url.includes('must-not-copy'));
        return remoteFetch(url, init);
      });
      assert.ok(
        report.errors.some(
          (item) => item.project_id === 'team' && item.error === 'no_existing_zcode_key'
        )
      );
      assert.ok(!report.api_keys.some((item) => item.api_key.startsWith('must-not-copy')));
      const data = structuredClone(local);
      data.errors = [];
      data.remote = [];
      data.local_sources[0].selections.bigmodel = null;
      await collectRemote({ ...options, remote: true, allProjects: true }, data, remoteFetch);
      assert.ok(data.api_keys.some((item) => item.api_key === 'team-id.remote-secret'));
    });
    await test('ZAI personal Bearer and team raw OAuth remain distinct', async () => {
      const report = structuredClone(local);
      report.errors = [];
      report.remote = [];
      report.local_sources[0].credentials = { 'oauth:zai:access_token': 'synthetic-zai-oauth' };
      report.local_sources[0].selections.zai = {
        kind: 'team-coding-plan',
        organizationId: 'org',
        projectId: 'team',
      };
      await collectRemote(
        { ...options, remote: true, region: 'zai' },
        report,
        async (url, init) => {
          assert.ok(url.startsWith('https://api.z.ai/'));
          if (url.endsWith('/getCustomerInfo')) {
            assert.ok(
              ['synthetic-zai-oauth', 'Bearer synthetic-zai-oauth'].includes(
                init.headers.Authorization
              )
            );
            return jsonResponse({
              code: 0,
              data: {
                organizations: [
                  {
                    organizationId: 'org',
                    projects: [
                      { projectId: 'personal', projectType: 1 },
                      { projectId: 'team', projectType: 2 },
                    ],
                  },
                ],
              },
            });
          }
          const team = url.includes('/projects/team/');
          assert.equal(
            init.headers.Authorization,
            team ? 'synthetic-zai-oauth' : 'Bearer synthetic-zai-oauth'
          );
          if (url.endsWith('/api_keys'))
            return jsonResponse({
              code: 0,
              data: [
                {
                  name: team ? 'zcode-team-api-key' : 'zcode-api-key',
                  keyType: team ? 2 : 1,
                  apiKey: team ? 'zai-team' : 'zai-personal',
                },
              ],
            });
          return jsonResponse({ code: 0, data: { secretKey: 'zai-secret' } });
        }
      );
      assert.equal(report.errors.length, 0);
      assert.ok(report.api_keys.some((item) => item.api_key === 'zai-team.zai-secret'));
      assert.ok(report.api_keys.some((item) => item.api_key === 'zai-personal.zai-secret'));
    });
    await test('versioned provider config and custom local cipher secret', async () => {
      const prior = await fs.readFile(path.join(directory, 'provider_config.json'), 'utf8');
      await write('provider_config.json', { schemaVersion: 1, config: JSON.parse(prior) });
      const report = await collect(options);
      assert.ok(report.api_keys.some((item) => item.api_key === 'custom.secret'));
      const customKey = localCipherKey({ ZCODE_CREDENTIAL_SECRET: 'synthetic-custom-secret' });
      const sealed = seal('custom-plaintext', customKey);
      const value = `enc:v1:${[sealed.iv, sealed.tag, sealed.ciphertext].map((part) => part.toString('base64url')).join('.')}`;
      assert.equal(decryptValue(value, customKey), 'custom-plaintext');
      customKey.fill(0);
      await fs.writeFile(path.join(directory, 'provider_config.json'), prior);
    });
    await test('HTTP rejection, redirect, schema and response size guards', async () => {
      await assert.rejects(
        requestJson(
          async () => new Response('sensitive body', { status: 302 }),
          'bigmodel',
          'business',
          '/test',
          'synthetic'
        ),
        /http_302/
      );
      await assert.rejects(
        requestJson(
          async () => jsonResponse({ code: 401, msg: 'sensitive body' }),
          'bigmodel',
          'business',
          '/test',
          'synthetic'
        ),
        /remote_rejected/
      );
      await assert.rejects(
        requestJson(
          async () => new Response('x'.repeat(MAX_RESPONSE + 1)),
          'bigmodel',
          'business',
          '/test',
          'synthetic'
        ),
        /response_too_large/
      );
      await assert.rejects(
        requestJson(
          () => {
            throw new Error('must not fetch');
          },
          'bigmodel',
          'business',
          '//evil.invalid',
          'synthetic'
        ),
        /untrusted_endpoint/
      );
    });
    await test('V4 handshake, private-key decryption, signature and proof of work', async () => {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
      const candidate = structuredClone(local.api_keys[0]);
      const mock = async (url, init) => {
        assert.equal(url, 'https://open.bigmodel.cn/api/paas/c1f3a7e2/v2/client');
        assert.equal(init.method, 'POST');
        assert.equal(init.headers.Authorization, candidate.api_key);
        const body = JSON.parse(init.body),
          parts = splitKey(body.apiKey);
        const expected = crypto
          .createHmac('sha256', derive(parts.secret, 'getSignKey_hmac'))
          .update(`get_sign_key\n${parts.id}\n${body.ts}\n${body.nonce}`)
          .digest('base64');
        assert.equal(body.sig, expected);
        const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' });
        const sealed = seal(
          privateDer.toString('base64'),
          derive(parts.secret, 'ed25519_priv'),
          Buffer.from(parts.id)
        );
        return jsonResponse({
          code: 200,
          data: {
            privateCipher: Buffer.concat([sealed.iv, sealed.ciphertext, sealed.tag]).toString(
              'base64'
            ),
          },
        });
      };
      const result = await collectV4(candidate, '3.14.3', 'synthetic-session', mock);
      assert.equal(result.private_key_pem, privateKey.export({ format: 'pem', type: 'pkcs8' }));
      assert.ok(
        crypto.verify(
          null,
          Buffer.from(result.signed_message),
          publicKey,
          Buffer.from(result.headers['X-Client-Sig'], 'base64')
        )
      );
      assert.equal(
        crypto
          .createHash('sha256')
          .update(`${result.proof_of_work.seed}\n${result.headers['X-Client-Pow']}`)
          .digest()[0],
        0
      );
      assert.equal(result.example_only_not_sent_to_model, true);
      await assert.rejects(
        collectV4(candidate, '3.14.3', 'synthetic-session', async () =>
          jsonResponse({ code: 200, data: { privateCipher: Buffer.alloc(40).toString('base64') } })
        ),
        /decrypt_/
      );
    });
    await test('input files remain encrypted and malformed files report safe errors', async () => {
      assert.ok(
        (await fs.readFile(path.join(directory, 'credentials.json'), 'utf8')).includes('enc:v1:')
      );
      await fs.writeFile(path.join(directory, 'provider_config.json'), '{invalid-json');
      const report = await collect(options);
      assert.ok(report.errors.some((item) => item.error === 'invalid_json'));
      assert.ok(!JSON.stringify(report.errors).includes('synthetic-oauth'));
    });
    console.log(`PASS ${count} groups; synthetic data only, no real credentials or network.`);
  } finally {
    key.fill(0);
    if (previousDesktopHome === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
    else process.env.ZCODE_DESKTOP_HOME_DIR = previousDesktopHome;
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      'node scripts/zcode-credentials.mjs [--data-dir DIR] [--app APP | --client-version VERSION] [--remote] [--all-projects] [--v4] [--region bigmodel|zai] [--session-id ID]\n--remote: 查询已有项目 key，不创建。--v4: 握手并打印私钥及示例签名，不调用模型。\n默认完整明文输出本地凭据、device ID 和可本地派生的 V4 材料。--self-test: 仅运行合成测试。'
    );
    return;
  }
  if (options.selfTest) {
    await selfTest();
    return;
  }
  console.error('警告：将完整打印凭据及签名材料；不要录屏、分享输出或在共享终端运行。');
  const report = await collect(options);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.errors.length || !report.api_keys.length) process.exitCode = 1;
}

export { parseArgs, collect, collectV4, decryptValue, selectionFor, requestJson, signingInputs };
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`失败：${errorCode(error)}`);
    process.exitCode = 1;
  });
}
