import type { PipelineDefinition } from '../pipeline-engine.js';

export const meetingPrep: PipelineDefinition = {
  name: 'meeting-prep',
  description: 'Prepare context for upcoming meetings — gather calendar, related PRs, recent decisions',
  trigger: {
    type: 'manual',
  },
  steps: [
    {
      type: 'collector',
      name: 'calendar',
      config: { collector: 'calendar', days: 1 },
    },
    {
      type: 'collector',
      name: 'github-prs',
      config: { collector: 'github', focus: 'prs' },
      onError: 'skip',
    },
    {
      type: 'transform',
      name: 'format-prep',
      config: {
        template: 'meeting-prep',
        format: 'markdown',
      },
    },
    {
      type: 'action',
      name: 'send-brief',
      config: {
        channel: 'telegram',
        prefix: 'Meeting prep:',
      },
    },
  ],
};
