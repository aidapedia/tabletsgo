// Public API for the settings feature.
export {
  SettingsProvider,
  useSettings,
  DEFAULT_TABLE_ROW_LIMIT,
  MIN_TABLE_ROW_LIMIT,
  MAX_TABLE_ROW_LIMIT,
} from './stores/SettingsContext'
export { default as AppearanceSetting } from './components/AppearanceSetting'
export { default as DataSetting } from './components/DataSetting'
