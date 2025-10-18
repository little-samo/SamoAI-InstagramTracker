import { RegisterAgentAction } from '@little-samo/samo-ai';
import { LlmToolCall } from '@little-samo/samo-ai/common';
import { AgentAction } from '@little-samo/samo-ai/models';
import { z } from 'zod';

import { getChromePage } from './chrome-actions';

@RegisterAgentAction('browser_navigate')
export class BrowserNavigateAction extends AgentAction {
  public override get description(): string {
    return 'Navigate the browser to a specific URL. Input must be a full URL, e.g. https://example.com';
  }

  public override get parameters(): z.ZodSchema {
    return z.object({
      url: z.string().describe('The URL to navigate to'),
      tabName: z
        .string()
        .optional()
        .describe('Name of the tab to perform the action on. If not specified, uses the first available tab.'),
    });
  }

  public override async execute(_call: LlmToolCall): Promise<void> {
    const action = _call.arguments as { url: string; tabName?: string };

    try {
      const page = getChromePage(action.tabName);
      if (!page)
        throw new Error(
          'Browser not launched. Please run launch_browser first.'
        );

      await page.goto(action.url);
      const title = await page.title();

      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Successfully navigated to ${action.url}. Page title: ${title}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Error navigating to ${action.url}: ${errorMessage}`
      );
    }
  }
}

@RegisterAgentAction('browser_wait_for_navigation')
export class BrowserWaitForNavigationAction extends AgentAction {
  public override get description(): string {
    return 'Wait for navigation to complete using specified strategy';
  }

  public override get parameters(): z.ZodSchema {
    return z.object({
      strategy: z
        .string()
        .optional()
        .default('all')
        .describe('Navigation wait strategy'),
      tabName: z
        .string()
        .optional()
        .describe('Name of the tab to perform the action on. If not specified, uses the first available tab.'),
    });
  }

  public override async execute(_call: LlmToolCall): Promise<void> {
    const action = _call.arguments as { strategy?: string; tabName?: string };

    try {
      const page = getChromePage(action.tabName);
      if (!page)
        throw new Error(
          'Browser not launched. Please run launch_browser first.'
        );

      await page.waitForFunction(() => document.readyState === 'complete');

      // 1초 추가 대기
      await new Promise((resolve) => setTimeout(resolve, 3000));

      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Navigation completed with strategy: ${action.strategy || 'all'}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Error waiting for navigation: ${errorMessage}`
      );
    }
  }
}

// Removed back/forward navigation actions not used by instagram_parsing
