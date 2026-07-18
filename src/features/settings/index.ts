// Public API for the settings feature.
export {
  SettingsProvider,
  useSettings,
  DEFAULT_TABLE_ROW_LIMIT,
  MIN_TABLE_ROW_LIMIT,
  MAX_TABLE_ROW_LIMIT,
  DEFAULT_QUERY_TIMEOUT,
  MIN_QUERY_TIMEOUT,
  MAX_QUERY_TIMEOUT,
  DEFAULT_DIRECT_EXECUTE,
} from './stores/SettingsContext'
export { default as AppearanceSetting } from './components/AppearanceSetting'
export { default as DensitySetting } from './components/DensitySetting'
export { default as DataSetting } from './components/DataSetting'
