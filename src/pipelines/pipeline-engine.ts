import { EventEmitter } from 'events';

export type StepType = 'collector' | 'transform' | 'action' | 'condition';

export interface PipelineStep {
  id?: string;
  type: StepType;
  name?: string;
  config: Record<string, unknown>;
  onError?: 'stop' | 'skip' | 'retry';
  retryCount?: number;
}

export interface PipelineDefinition {
  name: string;
  description?: string;
  trigger?: {
    type: 'cron' | 'webhook' | 'event' | 'manual';
    schedule?: string;
    event?: string;
    webhookPath?: string;
  };
  steps: PipelineStep[];
  metadata?: Record<string, unknown>;
}

export interface StepResult {
  stepIndex: number;
  stepName: string;
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}

export interface PipelineResult {
  pipeline: string;
  success: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  steps: StepResult[];
  output?: unknown;
}

type StepHandler = (config: Record<string, unknown>, context: PipelineContext) => Promise<unknown>;

export interface PipelineContext {
  pipeline: string;
  previousResults: StepResult[];
  data: Record<string, unknown>;
}

export class PipelineEngine extends EventEmitter {
  private handlers = new Map<string, StepHandler>();
  private pipelines = new Map<string, PipelineDefinition>();

  registerHandler(type: string, handler: StepHandler): void {
    this.handlers.set(type, handler);
  }

  registerPipeline(definition: PipelineDefinition): void {
    this.pipelines.set(definition.name, definition);
  }

  getPipeline(name: string): PipelineDefinition | undefined {
    return this.pipelines.get(name);
  }

  listPipelines(): PipelineDefinition[] {
    return Array.from(this.pipelines.values());
  }

  async run(nameOrDef: string | PipelineDefinition): Promise<PipelineResult> {
    const definition = typeof nameOrDef === 'string'
      ? this.pipelines.get(nameOrDef)
      : nameOrDef;

    if (!definition) {
      throw new Error(`Pipeline not found: ${nameOrDef}`);
    }

    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    const context: PipelineContext = {
      pipeline: definition.name,
      previousResults: stepResults,
      data: {},
    };

    this.emit('pipeline:start', { pipeline: definition.name, startedAt });

    let success = true;

    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      const stepName = step.name ?? `${step.type}-${i}`;
      const stepStart = Date.now();

      this.emit('step:start', { pipeline: definition.name, step: stepName, index: i });

      try {
        const handler = this.handlers.get(step.type);
        if (!handler) {
          throw new Error(`No handler for step type: ${step.type}`);
        }

        let data: unknown;
        let attempts = 0;
        const maxAttempts = (step.onError === 'retry' ? Math.max(1, step.retryCount ?? 3) : 1);

        while (attempts < maxAttempts) {
          try {
            data = await handler(step.config, context);
            break;
          } catch (err) {
            attempts++;
            if (attempts >= maxAttempts) throw err;
            await new Promise((r) => setTimeout(r, 1000 * attempts));
          }
        }

        const result: StepResult = {
          stepIndex: i,
          stepName,
          success: true,
          data,
          durationMs: Date.now() - stepStart,
        };
        stepResults.push(result);
        context.data[stepName] = data;

        this.emit('step:complete', { pipeline: definition.name, step: stepName, result });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const result: StepResult = {
          stepIndex: i,
          stepName,
          success: false,
          error,
          durationMs: Date.now() - stepStart,
        };
        stepResults.push(result);

        this.emit('step:error', { pipeline: definition.name, step: stepName, error });

        if (step.onError === 'skip') {
          continue;
        } else {
          success = false;
          break;
        }
      }
    }

    const completedAt = new Date().toISOString();
    const pipelineResult: PipelineResult = {
      pipeline: definition.name,
      success,
      startedAt,
      completedAt,
      durationMs: Date.now() - startTime,
      steps: stepResults,
      output: stepResults[stepResults.length - 1]?.data,
    };

    this.emit('pipeline:complete', pipelineResult);
    return pipelineResult;
  }
}
