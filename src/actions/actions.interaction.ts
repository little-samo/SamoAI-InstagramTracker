import { RegisterAgentAction } from '@little-samo/samo-ai';
import { LlmToolCall } from '@little-samo/samo-ai/common';
import { AgentAction } from '@little-samo/samo-ai/models';
import { z } from 'zod';

import { getChromePage } from './chrome-actions';

@RegisterAgentAction('browser_click')
export class BrowserClickAction extends AgentAction {
  public override get description(): string {
    return 'Click an element on the page using a CSS selector';
  }

  public override get parameters(): z.ZodSchema {
    return z.object({
      selector: z.string().describe('CSS selector of the element to click'),
      waitAfterMs: z
        .number()
        .optional()
        .default(300)
        .describe('Optional sleep after click in milliseconds'),
      tabName: z
        .string()
        .optional()
        .describe('Name of the tab to perform the action on. If not specified, uses the first available tab.'),
    });
  }

  public override async execute(call: LlmToolCall): Promise<void> {
    const action = call.arguments as { selector: string; waitAfterMs?: number; tabName?: string };

    try {
      const page = getChromePage(action.tabName);
      if (!page)
        throw new Error(
          'Browser not launched. Please run launch_browser first.'
        );

      const exists = await page.$(action.selector);
      if (!exists) {
        await this.location.addSystemMessage(
          `[${this.agent.model.name}] Element not found for selector: ${action.selector}`
        );
        return;
      }

      await page.click(action.selector, { delay: 50 });

      // optional short wait to allow DOM updates/navigation
      if (action.waitAfterMs && action.waitAfterMs > 0) {
        await new Promise((r) => setTimeout(r, action.waitAfterMs));
      }

      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Clicked element: ${action.selector}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Error clicking element: ${errorMessage}`
      );
    }
  }
}

@RegisterAgentAction('browser_scroll')
export class BrowserScrollAction extends AgentAction {
  public override get description(): string {
    return 'Scroll the page by a specific amount or to a position';
  }

  public override get parameters(): z.ZodSchema {
    return z.object({
      direction: z
        .enum(['down', 'up'])
        .optional()
        .default('down')
        .describe('Scroll direction'),
      pixels: z
        .number()
        .optional()
        .default(1000)
        .describe('Number of pixels to scroll'),
      toBottom: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, scroll to the bottom of the page'),
      waitAfterMs: z
        .number()
        .optional()
        .default(300)
        .describe('Optional sleep after scroll in milliseconds'),
      tabName: z
        .string()
        .optional()
        .describe('Name of the tab to perform the action on. If not specified, uses the first available tab.'),
    });
  }

  public override async execute(call: LlmToolCall): Promise<void> {
    const action = call.arguments as {
      direction?: 'down' | 'up';
      pixels?: number;
      toBottom?: boolean;
      waitAfterMs?: number;
      tabName?: string;
    };

    try {
      const page = getChromePage(action.tabName);
      if (!page)
        throw new Error(
          'Browser not launched. Please run launch_browser first.'
        );

      if (action.toBottom) {
        await page.evaluate(async () => {
          await new Promise<void>((resolve) => {
            const distance = 800;
            const timer = setInterval(() => {
              const { scrollTop, scrollHeight, clientHeight } =
                document.documentElement;
              window.scrollBy(0, distance);
              if (scrollTop + clientHeight >= scrollHeight - 10) {
                clearInterval(timer);
                resolve();
              }
            }, 100);
          });
        });
      } else {
        const delta =
          (action.direction === 'up' ? -1 : 1) * (action.pixels ?? 1000);
        await page.evaluate((dy) => window.scrollBy(0, dy), delta);
      }

      if (action.waitAfterMs && action.waitAfterMs > 0) {
        await new Promise((r) => setTimeout(r, action.waitAfterMs));
      }

      const opts: string[] = [];
      if (action.toBottom) opts.push('toBottom: true');
      else
        opts.push(
          `direction: ${action.direction ?? 'down'}`,
          `pixels: ${action.pixels ?? 1000}`
        );
      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Scrolled page (${opts.join(', ')})`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Error scrolling page: ${errorMessage}`
      );
    }
  }
}

@RegisterAgentAction('browser_wait')
export class BrowserWaitAction extends AgentAction {
  public override get description(): string {
    return 'Wait for a specified amount of time in milliseconds';
  }

  public override get parameters(): z.ZodSchema {
    return z.object({
      milliseconds: z
        .number()
        .optional()
        .default(3000)
        .describe('Number of milliseconds to wait (default: 3000ms = 3 seconds)'),
    });
  }

  public override async execute(call: LlmToolCall): Promise<void> {
    const action = call.arguments as { milliseconds?: number };

    try {
      const waitTime = action.milliseconds || 3000;
      await new Promise((resolve) => setTimeout(resolve, waitTime));

      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Waited for ${waitTime}ms (${waitTime / 1000}s)`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Error during wait: ${errorMessage}`
      );
    }
  }
}
