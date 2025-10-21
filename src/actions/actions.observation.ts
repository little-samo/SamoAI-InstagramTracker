import { RegisterAgentAction, SamoAI } from '@little-samo/samo-ai';
import { LlmToolCall } from '@little-samo/samo-ai/common';
import { AgentAction } from '@little-samo/samo-ai/models';
import { z } from 'zod';

import { getChromePage } from './chrome-actions';

@RegisterAgentAction('view_screen')
export class ViewScreenAction extends AgentAction {
  public override get description(): string {
    return 'Take a screenshot and return it as base64 data. Input flags: full (for full page capture), high (for high quality), small (for smaller viewport)';
  }

  public override get parameters(): z.ZodSchema {
    return z.object({
      input: z
        .string()
        .optional()
        .describe(
          'Flags: full (for full page capture), high (for high quality), small (for smaller viewport)'
        ),
      tabName: z
        .string()
        .optional()
        .describe(
          'Name of the tab to perform the action on. If not specified, uses the first available tab.'
        ),
    });
  }

  public override async execute(call: LlmToolCall): Promise<void> {
    const action = call.arguments as { input?: string; tabName?: string };

    try {
      const page = getChromePage(action.tabName);
      if (!page)
        throw new Error(
          'Browser not launched. Please run launch_browser first.'
        );

      // Limit to viewport only (fullPage always false)
      const quality = action.input?.includes('high') ? 1.0 : 0.8;
      const maxWidth = action.input?.includes('small') ? 800 : 1200;

      // Set viewport size
      await page.setViewport({ width: maxWidth, height: 600 });

      const screenshot = await page.screenshot({
        fullPage: false, // Always viewport only
        type: 'jpeg',
        quality: quality * 100,
      });

      const base64 = (screenshot as Buffer).toString('base64');

      // Save the screenshot into location state images[0]
      await SamoAI.instance.locationRepository.updateLocationStateImage(
        this.location.id,
        0,
        `data:image/jpeg;base64,${base64}`
      );

      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Screenshot captured and saved`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Error taking screenshot: ${errorMessage}`
      );
    }
  }
}

@RegisterAgentAction('browser_snapshot_dom')
export class BrowserSnapshotDomAction extends AgentAction {
  public override get description(): string {
    return 'Capture DOM snapshot of the current page. Use searchTerm to filter elements containing specific text (e.g., "busan_food" or "#busan_food")';
  }

  public override get parameters(): z.ZodSchema {
    return z.object({
      searchTerm: z
        .string()
        .optional()
        .describe(
          'Filter elements containing this text (supports hashtag format like #busan_food)'
        ),
      tabName: z
        .string()
        .optional()
        .describe(
          'Name of the tab to perform the action on. If not specified, uses the first available tab.'
        ),
    });
  }

  public override async execute(_call: LlmToolCall): Promise<void> {
    const action = _call.arguments as {
      searchTerm?: string;
      tabName?: string;
    };

    try {
      const page = getChromePage(action.tabName);
      if (!page)
        throw new Error(
          'Browser not launched. Please run launch_browser first.'
        );

      const limit = 100000; // Fixed limit of 100,000 characters
      let html = '';

      // Always use body selector
      const selector = 'body';

      // Set search term option first
      await page.evaluate(
        (opts) => {
          (window as unknown as { __snapshot_opts?: unknown }).__snapshot_opts =
            opts;
        },
        {
          searchTerm: action.searchTerm || '',
        }
      );

      const exists = await page.$$eval(selector, (els) => els.length);
      if (!exists) {
        await this.location.addSystemMessage(
          `[${this.agent.model.name}] No elements found matching selector: ${selector}`
        );
        return;
      }

      html = await page.$$eval(selector, (elements: Element[]) => {
        const searchTerm =
          (window as unknown as { __snapshot_opts?: { searchTerm?: string } })
            .__snapshot_opts?.searchTerm || '';

        // Function to check if element contains search term
        function containsSearchTerm(element: Element, term: string): boolean {
          if (!term) return true; // No search term means include all

          const text = element.textContent?.toLowerCase() || '';
          const termLower = term.toLowerCase();

          // Check for hashtag format (#busan_food)
          const hashtagTerm = '#' + termLower;

          return text.includes(termLower) || text.includes(hashtagTerm);
        }

        // Function to clean HTML by removing unnecessary content
        function cleanHtml(html: string): string {
          // Remove all script tags and their content
          html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
          // Remove all style tags and their content
          html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
          // Remove all link tags (CSS, icons, etc.)
          html = html.replace(/<link[^>]*>/gi, '');
          // Remove all noscript tags
          html = html.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');
          // Remove all comment tags
          html = html.replace(/<!--[\s\S]*?-->/g, '');

          // Remove data:image base64 URLs (including very long ones)
          html = html.replace(
            /data:image\/[^;]+;base64,[A-Za-z0-9+/=\s]+/g,
            ''
          );
          // Remove data:video base64 URLs
          html = html.replace(
            /data:video\/[^;]+;base64,[A-Za-z0-9+/=\s]+/g,
            ''
          );
          // Remove data:audio base64 URLs
          html = html.replace(
            /data:audio\/[^;]+;base64,[A-Za-z0-9+/=\s]+/g,
            ''
          );
          // Remove data:text/javascript base64 URLs
          html = html.replace(
            /data:text\/javascript[^;]+;base64,[A-Za-z0-9+/=\s]+/g,
            ''
          );
          // Remove data:text/css base64 URLs
          html = html.replace(
            /data:text\/css[^;]+;base64,[A-Za-z0-9+/=\s]+/g,
            ''
          );
          // Remove any other data: URLs with base64 (catch-all)
          html = html.replace(/data:[^;]+;base64,[A-Za-z0-9+/=\s]+/g, '');
          // Remove charset=utf-8;base64 patterns
          html = html.replace(/charset=utf-8;base64,[A-Za-z0-9+/=\s]+/g, '');

          // Remove all src and srcset attributes (not needed for parsing)
          html = html.replace(/\s*src="[^"]*"/gi, '');
          html = html.replace(/\s*srcset="[^"]*"/gi, '');

          // Simplify links - keep only href and essential attributes
          html = html.replace(
            /<a([^>]*?)href="([^"]*)"([^>]*?)>/gi,
            (_match, _before, href, _after) => {
              return `<a href="${href}">`;
            }
          );

          // Remove all class attributes (not needed for parsing)
          html = html.replace(/\s*class="[^"]*"/gi, '');

          // Remove all style attributes (not needed for parsing)
          html = html.replace(/\s*style="[^"]*"/gi, '');

          // Remove other unnecessary attributes
          html = html.replace(
            /\s*(role|tabindex|aria-label|aria-hidden|aria-describedby|data-[^=]*|crossorigin|nonce|async|defer)="[^"]*"/gi,
            ''
          );

          // Remove SVG elements (icons, graphics)
          html = html.replace(/<svg[^>]*>.*?<\/svg>/gis, '');

          // Remove navigation and footer elements
          html = html.replace(/<(nav|footer|header)[^>]*>.*?<\/\1>/gis, '');

          // Remove elements with common UI class patterns
          html = html.replace(
            /<[^>]*(?:navigation|nav|footer|header|sidebar|menu|toolbar|breadcrumb)[^>]*>.*?<\/[^>]*>/gis,
            ''
          );

          // Remove empty divs and spans
          html = html.replace(/<(div|span)[^>]*>\s*<\/\1>/gi, '');

          // Remove excessive whitespace and newlines
          html = html.replace(/\s+/g, ' ').trim();

          return html;
        }

        // Prefer capturing inside <main> to avoid nav/sidebars/footers
        const mainEl = document.querySelector('main');
        const baseElements: Element[] = mainEl ? [mainEl] : elements;

        // Collect <head> meta tags to include in snapshot
        const headMeta = Array.from(
          (document.head && document.head.querySelectorAll('meta')) || []
        )
          .map((el) => el.outerHTML)
          .join('\n');

        // When a search term is provided, collect matching descendants within main/body
        if (searchTerm) {
          const scopeRoot = baseElements[0] || document.body;
          const matches = Array.from(scopeRoot.querySelectorAll('*')).filter(
            (el) => containsSearchTerm(el, searchTerm)
          );
          const body = matches
            .map((el) => cleanHtml(el.outerHTML))
            .join('\n\n');
          return headMeta ? headMeta + '\n\n' + body : body;
        }

        // Otherwise, snapshot only the <main> (or body fallback)
        const body = baseElements
          .map((el) => cleanHtml(el.outerHTML))
          .join('\n\n');
        return headMeta ? headMeta + '\n\n' + body : body;
      });

      const truncated = html.length > limit ? html.slice(0, limit) : html;

      // Save DOM snapshot into location rendering
      await SamoAI.instance.locationRepository.updateLocationStateRendering(
        this.location.id,
        truncated
      );
      const options: string[] = [];
      if (action.searchTerm) options.push(`searchTerm: ${action.searchTerm}`);

      await this.location.addSystemMessage(
        `[${this.agent.model.name}] DOM snapshot captured and saved to location rendering`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.location.addSystemMessage(
        `[${this.agent.model.name}] Error capturing DOM snapshot: ${errorMessage}`
      );
    }
  }
}

// Removed other observation actions to keep only browser_snapshot_dom used by location
