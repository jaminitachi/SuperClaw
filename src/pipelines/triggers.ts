export interface TriggerConfig {
  type: 'cron' | 'webhook' | 'event' | 'manual';
  schedule?: string;
  event?: string;
  webhookPath?: string;
}

export interface RegisteredTrigger {
  pipelineName: string;
  config: TriggerConfig;
  active: boolean;
  lastRun?: string;
  nextRun?: string;
}

export class TriggerManager {
  private triggers = new Map<string, RegisteredTrigger>();
  private eventHandlers = new Map<string, Set<string>>();

  register(pipelineName: string, config: TriggerConfig): void {
    this.triggers.set(pipelineName, {
      pipelineName,
      config,
      active: true,
    });

    if (config.type === 'event' && config.event) {
      if (!this.eventHandlers.has(config.event)) {
        this.eventHandlers.set(config.event, new Set());
      }
      this.eventHandlers.get(config.event)!.add(pipelineName);
    }
  }

  unregister(pipelineName: string): void {
    const trigger = this.triggers.get(pipelineName);
    if (trigger?.config.type === 'event' && trigger.config.event) {
      this.eventHandlers.get(trigger.config.event)?.delete(pipelineName);
    }
    this.triggers.delete(pipelineName);
  }

  getPipelinesForEvent(event: string): string[] {
    return Array.from(this.eventHandlers.get(event) ?? []);
  }

  getCronTriggers(): RegisteredTrigger[] {
    return Array.from(this.triggers.values()).filter(
      (t) => t.config.type === 'cron' && t.active
    );
  }

  list(): RegisteredTrigger[] {
    return Array.from(this.triggers.values());
  }

  markRun(pipelineName: string): void {
    const trigger = this.triggers.get(pipelineName);
    if (trigger) {
      trigger.lastRun = new Date().toISOString();
    }
  }

  setActive(pipelineName: string, active: boolean): void {
    const trigger = this.triggers.get(pipelineName);
    if (trigger) trigger.active = active;
  }
}
