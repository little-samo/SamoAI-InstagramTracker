import * as fs from 'fs';

import { RegisterAgentAction } from '@little-samo/samo-ai';
import { LlmToolCall } from '@little-samo/samo-ai/common';
import { AgentAction } from '@little-samo/samo-ai/models';
import puppeteer, { Browser, Page } from 'puppeteer';
import { z } from 'zod';

// Global browser instance to maintain state
let globalBrowser: Browser | null = null;
let globalPages: Map<string, Page> = new Map();

export function getChromePage(tabName?: string): Page | null {
  if (!tabName) {
    // Return the first available page if no specific tab is requested
    return globalPages.values().next().value || null;
  }
  return globalPages.get(tabName) || null;
}

export function getAllChromePages(): Map<string, Page> {
  return globalPages;
}

export function getChromePageNames(): string[] {
  return Array.from(globalPages.keys());
}

/**
 * Launch Chrome browser programmatically
 * This function can be called from CLI or other parts of the application
 */
export async function launchChromeBrowser(
  url: string = 'https://www.instagram.com/',
  tabName: string = 'default'
): Promise<void> {
  try {
    // Close existing browser if any
    if (globalBrowser) {
      await globalBrowser.close();
      globalBrowser = null;
      globalPages.clear();
    }

    // Find Chrome executable
    const chromePath = findChromeExecutable();
    if (!chromePath) {
      throw new Error(
        'Chrome executable not found. Please make sure Google Chrome is installed.'
      );
    }

    // Launch new browser - always visible for better user experience
    const launchOptions: {
      headless: boolean;
      executablePath: string;
      args: string[];
      defaultViewport: null;
    } = {
      headless: false, // Always visible for supervision
      executablePath: chromePath, // Use system Chrome
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
      defaultViewport: null,
    };

    globalBrowser = await puppeteer.launch(launchOptions);

    // Create new page for the specified tab
    const newPage = await globalBrowser.newPage();
    globalPages.set(tabName, newPage);

    if (url) {
      await newPage.goto(url);
    }

    console.log(`Chrome browser launched successfully with tab: ${tabName}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error launching Chrome browser:', errorMessage);
    throw error;
  }
}

/**
 * Close Chrome browser
 */
export async function closeChromeBrowser(): Promise<void> {
  try {
    if (globalBrowser) {
      await globalBrowser.close();
      globalBrowser = null;
      globalPages.clear();
      console.log('Chrome browser closed successfully');
    } else {
      console.log('ℹNo browser instance was running');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error closing browser:', errorMessage);
    throw error;
  }
}

/**
 * Find Chrome executable path on Windows
 */
function findChromeExecutable(): string | null {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Users\\' +
      process.env.USERNAME +
      '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Users\\' +
      process.env.USERNAME +
      '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
  ];

  for (const chromePath of possiblePaths) {
    if (fs.existsSync(chromePath)) {
      return chromePath;
    }
  }

  return null;
}

/**
 * Create a new tab in the existing browser
 */
export async function createNewTab(
  tabName: string,
  url?: string
): Promise<void> {
  try {
    if (!globalBrowser) {
      throw new Error('Browser not launched. Please launch browser first.');
    }

    if (globalPages.has(tabName)) {
      throw new Error(`Tab with name "${tabName}" already exists.`);
    }

    const newPage = await globalBrowser.newPage();
    globalPages.set(tabName, newPage);

    if (url) {
      await newPage.goto(url);
    }

    console.log(`New tab created: ${tabName}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error creating new tab:', errorMessage);
    throw error;
  }
}

/**
 * Switch to a specific tab
 */
export async function switchToTab(tabName: string): Promise<void> {
  try {
    const page = globalPages.get(tabName);
    if (!page) {
      throw new Error(`Tab "${tabName}" not found.`);
    }

    // Bring the tab to front
    await page.bringToFront();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error switching to tab:', errorMessage);
    throw error;
  }
}

/**
 * Close a specific tab
 */
export async function closeTab(tabName: string): Promise<void> {
  try {
    const page = globalPages.get(tabName);
    if (!page) {
      throw new Error(`Tab "${tabName}" not found.`);
    }

    await page.close();
    globalPages.delete(tabName);
    console.log(`Tab closed: ${tabName}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error closing tab:', errorMessage);
    throw error;
  }
}

@RegisterAgentAction('launch_browser')
export class ChromeLaunchAction extends AgentAction {
  public override get description(): string {
    return 'Launch a new Chrome browser instance. This will open a new browser window that can be controlled programmatically.';
  }

  public override get parameters(): z.ZodSchema {
    return z.object({
      headless: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'Whether to run in headless mode (true) or with visible browser window (false). Default is false for visible browser.'
        ),
      url: z
        .string()
        .optional()
        .describe('Optional URL to navigate to after launching'),
      tabName: z
        .string()
        .optional()
        .default('default')
        .describe('Name for the initial tab. Default is "default".'),
    });
  }

  public override async execute(call: LlmToolCall): Promise<void> {
    const action = call.arguments as { headless?: boolean; url?: string; tabName?: string };

    try {
      await launchChromeBrowser(action.url, action.tabName);

      let result = `Successfully launched Chrome browser in visible mode for supervision.`;

      if (action.url) {
        result += ` Navigated to: ${action.url}`;
      }

      if (action.tabName) {
        result += ` Created tab: ${action.tabName}`;
      }

      await this.location.addSystemMessage(
        `[${this.agent.model.name}] ${result}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Error launching Chrome: ${errorMessage}`
      );
    }
  }
}

@RegisterAgentAction('close_browser')
export class ChromeCloseAction extends AgentAction {
  public override get description(): string {
    return 'Close the current browser instance. This will close all browser windows and free up resources.';
  }

  public override get parameters(): z.ZodSchema {
    return z.object({});
  }

  public override async execute(_call: LlmToolCall): Promise<void> {
    try {
      await closeChromeBrowser();

      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Successfully closed Chrome browser`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Error closing browser: ${errorMessage}`
      );
    }
  }
}

@RegisterAgentAction('create_tab')
export class CreateTabAction extends AgentAction {
  public override get description(): string {
    return 'Create a new tab in the existing browser. Useful for managing multiple tasks like post list and post&profile views.';
  }

  public override get parameters(): z.ZodSchema {
    return z.object({
      tabName: z
        .string()
        .describe('Name for the new tab (e.g., "post_list", "post_profile")'),
      url: z
        .string()
        .optional()
        .describe('Optional URL to navigate to in the new tab'),
    });
  }

  public override async execute(call: LlmToolCall): Promise<void> {
    const action = call.arguments as { tabName: string; url?: string };

    try {
      await createNewTab(action.tabName, action.url);

      let result = `Successfully created new tab: ${action.tabName}`;
      if (action.url) {
        result += ` and navigated to: ${action.url}`;
      }

      await this.location.addSystemMessage(
        `[${this.agent.model.name}] ${result}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Error creating tab: ${errorMessage}`
      );
    }
  }
}

@RegisterAgentAction('switch_tab')
export class SwitchTabAction extends AgentAction {
  public override get description(): string {
    return 'Switch to a specific tab by name. This will bring the tab to the front.';
  }

  public override get parameters(): z.ZodSchema {
    return z.object({
      tabName: z
        .string()
        .describe('Name of the tab to switch to'),
    });
  }

  public override async execute(call: LlmToolCall): Promise<void> {
    const action = call.arguments as { tabName: string };

    try {
      await switchToTab(action.tabName);

      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Successfully switched to tab: ${action.tabName}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Error switching tab: ${errorMessage}`
      );
    }
  }
}

@RegisterAgentAction('close_tab')
export class CloseTabAction extends AgentAction {
  public override get description(): string {
    return 'Close a specific tab by name.';
  }

  public override get parameters(): z.ZodSchema {
    return z.object({
      tabName: z
        .string()
        .describe('Name of the tab to close'),
    });
  }

  public override async execute(call: LlmToolCall): Promise<void> {
    const action = call.arguments as { tabName: string };

    try {
      await closeTab(action.tabName);

      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Successfully closed tab: ${action.tabName}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Error closing tab: ${errorMessage}`
      );
    }
  }
}

@RegisterAgentAction('list_tabs')
export class ListTabsAction extends AgentAction {
  public override get description(): string {
    return 'List all currently open tabs in the browser.';
  }

  public override get parameters(): z.ZodSchema {
    return z.object({});
  }

  public override async execute(_call: LlmToolCall): Promise<void> {
    try {
      const tabNames = getChromePageNames();
      
      if (tabNames.length === 0) {
        await this.location.addSystemMessage(
          `[${this.agent.model.name}] No tabs are currently open.`
        );
      } else {
        const tabList = tabNames.join(', ');
        await this.location.addSystemMessage(
          `[${this.agent.model.name}] Currently open tabs: ${tabList}`
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Error listing tabs: ${errorMessage}`
      );
    }
  }
}
