// The partitions and consumers views that used to be tabs of the Kafka topic
// view, as a dashboard: one `topic` picker over every widget, so a board covers
// any topic and can be extended with widgets of the user's own. The tiles and
// the partitions table read `DESCRIBE {{topic}}` — the same rows, aggregated or
// drawn per column (badges for replicas, a bar for each partition's share).
import type { Template } from '../types'

// The Kafka console's own lag colors: worth a look from 100, an order of magnitude past that red.
const LAG_STEPS = [{}, { from: 100, color: 'amber' }, { from: 10000, color: 'red' }]

export const kafkaTopicOverview: Template = {
  id: 'kafka-topic-overview',
  name: 'Kafka Topic Overview',
  description:
    "A topic's partitions — retained messages, produce rate, leader, replicas, in-sync set and offsets — next to the consumer groups reading it and their lag on that topic, with the cluster's brokers below. Pick the topic from the filter bar.",
  databases: ['kafka'],
  workflows: [],
  dashboards: [
    {
      name: 'Kafka Topic Overview',
      config: {
        variables: [{ id: 'v-topic', name: 'topic', label: 'Topic', source: 'query', query: 'TOPICS' }],
        widgets: [
          {
            id: 'w-partitions-head',
            type: 'text',
            title: '',
            text: '## Partitions',
            layout: { x: 0, y: 0, w: 12, h: 1 },
          },
          {
            id: 'w-retained',
            type: 'metric',
            title: 'Retained messages',
            query: 'DESCRIBE {{topic}}',
            metric: { aggregate: 'sum', column: 'messages', format: 'compact', variant: 'tile', thresholds: [{ caption: 'latest − earliest, all partitions' }] },
            layout: { x: 0, y: 1, w: 3, h: 2 },
          },
          {
            id: 'w-partition-count',
            type: 'metric',
            title: 'Partitions',
            query: 'DESCRIBE {{topic}}',
            metric: { aggregate: 'count', variant: 'tile', thresholds: [{ caption: 'in {{topic}}' }] },
            layout: { x: 3, y: 1, w: 3, h: 2 },
          },
          {
            id: 'w-produce-rate',
            type: 'metric',
            title: 'Produce rate',
            query: 'DESCRIBE {{topic}}',
            unit: 'msg/s',
            metric: { aggregate: 'rate', column: 'latest', format: 'compact', variant: 'tile', thresholds: [{ caption: 'sampled from end offsets every 10 s' }] },
            layout: { x: 6, y: 1, w: 3, h: 2 },
          },
          {
            id: 'w-under-replicated',
            type: 'metric',
            title: 'Under-replicated',
            query: 'DESCRIBE {{topic}}',
            metric: {
              aggregate: 'count',
              column: 'under_replicated',
              variant: 'tile',
              thresholds: [
                { caption: 'every replica in sync' },
                { from: 1, color: 'amber', caption: 'partitions with a replica out of sync' },
              ],
            },
            layout: { x: 9, y: 1, w: 3, h: 2 },
          },
          {
            id: 'w-partitions',
            type: 'table',
            title: 'Partitions',
            pageSize: 20,
            query: 'DESCRIBE {{topic}}',
            tableColumns: [
              { column: 'partition', label: 'Partition', mono: true },
              { column: 'leader', label: 'Leader', prefix: 'broker ' },
              { column: 'replicas', label: 'Replicas', display: 'badges', ref: 'isr' },
              { column: 'isr', label: 'In sync', display: 'count', ref: 'replicas' },
              { column: 'earliest', label: 'Earliest', display: 'number', mono: true },
              { column: 'latest', label: 'Latest', display: 'number', mono: true },
              { column: 'messages', label: 'Messages', display: 'number', mono: true },
              { column: 'messages', label: 'Share of topic', display: 'bar' },
            ],
            layout: { x: 0, y: 3, w: 12, h: 6 },
          },

          {
            id: 'w-consumers-head',
            type: 'text',
            title: '',
            text: '## Consumers',
            layout: { x: 0, y: 9, w: 12, h: 1 },
          },
          {
            id: 'w-consumers',
            type: 'table',
            title: 'Consumer groups',
            pageSize: 20,
            query: 'GROUPS TOPIC {{topic}}',
            tableColumns: [
              { column: 'group', label: 'Group', mono: true },
              { column: 'state', label: 'State' },
              { column: 'members', label: 'Members', display: 'number' },
              { column: 'lag', label: 'Lag on this topic', display: 'number', mono: true, thresholds: LAG_STEPS },
              { column: 'lag', label: 'Share of lag', display: 'bar', thresholds: LAG_STEPS },
            ],
            layout: { x: 0, y: 10, w: 12, h: 6 },
          },

          {
            id: 'w-cluster-head',
            type: 'text',
            title: '',
            text: '## Cluster',
            layout: { x: 0, y: 16, w: 12, h: 1 },
          },
          {
            id: 'w-brokers',
            type: 'table',
            title: 'Brokers',
            query: 'CLUSTER',
            tableColumns: [
              { column: 'node_id', label: 'Broker', mono: true },
              { column: 'host', label: 'Host', mono: true },
              { column: 'port', label: 'Port', mono: true },
              { column: 'controller', label: 'Controller' },
              { column: 'cluster_id', label: 'Cluster', mono: true },
            ],
            layout: { x: 0, y: 17, w: 12, h: 5 },
          },
        ],
      },
    },
  ],
}
