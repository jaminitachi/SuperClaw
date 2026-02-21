import { z } from 'zod';

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().optional(),
  allowedUsers: z.array(z.string()).default([]),
  allowFrom: z.array(z.string()).default([]),
  defaultChatId: z.string().optional().default(''),
  pollingIntervalMs: z.number().default(1000),
});

export const HeartbeatConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().default(30),
  collectors: z.array(z.string()).default(['system', 'dev', 'process']),
  alerting: z.object({
    cpuThreshold: z.number().default(90),
    memoryThreshold: z.number().default(85),
    diskThreshold: z.number().default(90),
  }).default({}),
});

export const MemoryConfigSchema = z.object({
  dbPath: z.string().default('data/memory.db'),
});

export const SuperClawConfigSchema = z.object({
  telegram: TelegramConfigSchema.default({}),
  heartbeat: HeartbeatConfigSchema.default({}),
  memory: MemoryConfigSchema.default({}),
  peekaboo: z.object({
    path: z.string().default('/opt/homebrew/bin/peekaboo'),
  }).default({}),
});

export type SuperClawConfig = z.infer<typeof SuperClawConfigSchema>;
