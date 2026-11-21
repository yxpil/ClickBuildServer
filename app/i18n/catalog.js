// 作者：yxpil
'use strict';

// 界面语言的单一事实来源。渲染层、主进程、安装器脚本和翻译生成器都从这里取。
// dir 用于 RTL 布局；nsis/lcid 用于安装器首次语言；null 表示 NSIS 没有内置该语言。
const SOURCE = 'zh-CN';

const LOCALES = [
  { id: 'zh-CN', label: '简体中文', english: 'Chinese (Simplified)', short: '中', dir: 'ltr', target: 'Simplified Chinese', nsis: 'zh_CN', lcid: 2052 },
  { id: 'zh-TW', label: '繁體中文', english: 'Chinese (Traditional)', short: '繁', dir: 'ltr', target: 'Traditional Chinese (Taiwan)', nsis: 'zh_TW', lcid: 1028 },
  { id: 'en-US', label: 'English', english: 'English (US)', short: 'EN', dir: 'ltr', target: 'English (United States)', nsis: 'en_US', lcid: 1033 },
  { id: 'ja-JP', label: '日本語', english: 'Japanese', short: 'JA', dir: 'ltr', target: 'Japanese', nsis: 'ja_JP', lcid: 1041 },
  { id: 'ko-KR', label: '한국어', english: 'Korean', short: 'KO', dir: 'ltr', target: 'Korean', nsis: 'ko_KR', lcid: 1042 },
  { id: 'fr-FR', label: 'Français', english: 'French', short: 'FR', dir: 'ltr', target: 'French', nsis: 'fr_FR', lcid: 1036 },
  { id: 'de-DE', label: 'Deutsch', english: 'German', short: 'DE', dir: 'ltr', target: 'German', nsis: 'de_DE', lcid: 1031 },
  { id: 'es-ES', label: 'Español', english: 'Spanish', short: 'ES', dir: 'ltr', target: 'Spanish', nsis: 'es_ES', lcid: 3082 },
  { id: 'pt-BR', label: 'Português (Brasil)', english: 'Portuguese (Brazil)', short: 'PT', dir: 'ltr', target: 'Portuguese (Brazil)', nsis: 'pt_BR', lcid: 1046 },
  { id: 'it-IT', label: 'Italiano', english: 'Italian', short: 'IT', dir: 'ltr', target: 'Italian', nsis: 'it_IT', lcid: 1040 },
  { id: 'ru-RU', label: 'Русский', english: 'Russian', short: 'RU', dir: 'ltr', target: 'Russian', nsis: 'ru_RU', lcid: 1049 },
  { id: 'ar-SA', label: 'العربية', english: 'Arabic', short: 'AR', dir: 'rtl', target: 'Arabic', nsis: 'ar_SA', lcid: 1025 },
  { id: 'nl-NL', label: 'Nederlands', english: 'Dutch', short: 'NL', dir: 'ltr', target: 'Dutch', nsis: 'nl_NL', lcid: 1043 },
  { id: 'pl-PL', label: 'Polski', english: 'Polish', short: 'PL', dir: 'ltr', target: 'Polish', nsis: 'pl_PL', lcid: 1045 },
  { id: 'tr-TR', label: 'Türkçe', english: 'Turkish', short: 'TR', dir: 'ltr', target: 'Turkish', nsis: 'tr_TR', lcid: 1055 },
  { id: 'th-TH', label: 'ไทย', english: 'Thai', short: 'TH', dir: 'ltr', target: 'Thai', nsis: 'th_TH', lcid: 1054 },
  { id: 'vi-VN', label: 'Tiếng Việt', english: 'Vietnamese', short: 'VI', dir: 'ltr', target: 'Vietnamese', nsis: 'vi_VN', lcid: 1066 },
  { id: 'id-ID', label: 'Bahasa Indonesia', english: 'Indonesian', short: 'ID', dir: 'ltr', target: 'Indonesian', nsis: null, lcid: 1057 },
  { id: 'hi-IN', label: 'हिन्दी', english: 'Hindi', short: 'HI', dir: 'ltr', target: 'Hindi', nsis: null, lcid: 1081 },
  { id: 'cs-CZ', label: 'Čeština', english: 'Czech', short: 'CS', dir: 'ltr', target: 'Czech', nsis: 'cs_CZ', lcid: 1029 },
  { id: 'sv-SE', label: 'Svenska', english: 'Swedish', short: 'SV', dir: 'ltr', target: 'Swedish', nsis: 'sv_SE', lcid: 1053 },
];

module.exports = { SOURCE, LOCALES };
