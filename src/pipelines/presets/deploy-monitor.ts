import type { PipelineDefinition } from '../pipeline-engine.js';

export const deployMonitor: PipelineDefinition = {
  name: 'deploy-monitor',
  description: 'Monitor deployment status and alert on failures',
  trigger: {
    type: 'event',
    event: 'deploy.complete',
  },
  steps: [
    {
      type: 'collector',
      name: 'ci-status',
      config: { collector: 'github', focus: 'ci' },
    },
    {
      type: 'condition',
      name: 'check-failure',
      config: {
        field: 'ci-status.ci.conclusion',
        equals: 'failure',
      },
    },
    {
      type: 'collector',
      name: 'sentry-check',
      config: { collector: 'sentry', timeframe: '15m' },
      onError: 'skip',
    },
    {
      type: 'transform',
      name: 'format-alert',
      config: {
        template: 'deploy-alert',
        severity: 'high',
      },
    },
    {
      type: 'action',
      name: 'alert-telegram',
      config: {
        channel: 'telegram',
        prefix: 'Deployment Alert:',
      },
    },
  ],
};
