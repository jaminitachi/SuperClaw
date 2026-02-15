import type { PipelineDefinition } from '../pipeline-engine.js';

export const morningBrief: PipelineDefinition = {
  name: 'morning-brief',
  description: 'Daily morning briefing — calendar, GitHub, system status',
  trigger: {
    type: 'cron',
    schedule: '0 8 * * 1-5',
  },
  steps: [
    {
      type: 'collector',
      name: 'calendar',
      config: { collector: 'calendar', days: 1 },
    },
    {
      type: 'collector',
      name: 'github',
      config: { collector: 'github' },
      onError: 'skip',
    },
    {
      type: 'collector',
      name: 'system',
      config: { collector: 'system' },
    },
    {
      type: 'transform',
      name: 'format-brief',
      config: {
        template: 'morning-brief',
        format: 'markdown',
      },
    },
    {
      type: 'action',
      name: 'send-telegram',
      config: {
        channel: 'telegram',
        prefix: 'Good morning! Here is your daily brief:',
      },
    },
  ],
};
