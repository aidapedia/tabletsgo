import type { Template } from '../types'
import { kafkaTopicOverview } from './kafkaTopicOverview'
import { pgHealthVacuum } from './pgHealthVacuum'

// Order here is the gallery's display order.
export const TEMPLATES: Template[] = [pgHealthVacuum, kafkaTopicOverview]
