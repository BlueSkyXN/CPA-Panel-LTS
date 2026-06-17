/**
 * i18next 国际化配置
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import en from './locales/en.json';
import ru from './locales/ru.json';
// LTS overlay: codex quota + remote cloud connect locales live in src/lts/i18n,
// isolated from the upstream-shared locale files and layered on at init.
import enLts from '@/lts/i18n/en.lts.json';
import zhCNLts from '@/lts/i18n/zh-CN.lts.json';
import zhTWLts from '@/lts/i18n/zh-TW.lts.json';
import ruLts from '@/lts/i18n/ru.lts.json';
import { getInitialLanguage } from '@/utils/language';

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'zh-TW': { translation: zhTW },
    en: { translation: en },
    ru: { translation: ru }
  },
  lng: getInitialLanguage(),
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false // React 已经转义
  },
  react: {
    useSuspense: false
  }
});

// Layer the LTS-owned codex bundles on top (deep merge, overwrite) so codex_quota and
// auth_files.codex_remote_cloud_connect* resolve at runtime while staying out of shared locales.
i18n.addResourceBundle('en', 'translation', enLts, true, true);
i18n.addResourceBundle('zh-CN', 'translation', zhCNLts, true, true);
i18n.addResourceBundle('zh-TW', 'translation', zhTWLts, true, true);
i18n.addResourceBundle('ru', 'translation', ruLts, true, true);

export default i18n;
