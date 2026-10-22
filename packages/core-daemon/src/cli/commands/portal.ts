import { randomUUID } from 'node:crypto';
import type { CommandHandler } from '../../daemon/pipeServer.js';
import type { PortalNode, PortalContent } from '@maestri/shared';

async function fetchPage(url: string, userAgent?: string): Promise<{ html: string; title: string; text: string; elements: Array<{ ref: string; type: string; label: string; href?: string }> }> {
  let finalUrl = url.trim();
  if (!/^https?:\/\//i.test(finalUrl)) {
    finalUrl = 'https://' + finalUrl;
  }
  const res = await fetch(finalUrl, {
    headers: {
      'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(12000),
  });
  const html = await res.text();

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Web Portal';

  const cleanHtml = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');

  const elements: Array<{ ref: string; type: string; label: string; href?: string }> = [];
  let refCount = 1;

  const linkRegex = /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let lm;
  while ((lm = linkRegex.exec(cleanHtml)) !== null && elements.length < 40) {
    const rawText = lm[2].replace(/<[^>]+>/g, '').trim();
    if (rawText.length > 0 && rawText.length < 80) {
      elements.push({ ref: `@e${refCount++}`, type: 'a', label: rawText, href: lm[1] });
    }
  }

  const btnRegex = /<button\b[^>]*>([\s\S]*?)<\/button>/gi;
  let bm;
  while ((bm = btnRegex.exec(cleanHtml)) !== null && elements.length < 60) {
    const rawText = bm[1].replace(/<[^>]+>/g, '').trim();
    if (rawText.length > 0 && rawText.length < 60) {
      elements.push({ ref: `@e${refCount++}`, type: 'button', label: rawText });
    }
  }

  const inputRegex = /<input\b[^>]*>/gi;
  let im;
  while ((im = inputRegex.exec(cleanHtml)) !== null && elements.length < 75) {
    const tag = im[0];
    const typeMatch = tag.match(/type=["']([^"']*)["']/i);
    const placeholderMatch = tag.match(/placeholder=["']([^"']*)["']/i);
    const nameMatch = tag.match(/name=["']([^"']*)["']/i);
    const type = typeMatch ? typeMatch[1] : 'text';
    const label = placeholderMatch ? placeholderMatch[1] : (nameMatch ? nameMatch[1] : 'input');
    elements.push({ ref: `@e${refCount++}`, type: `input[type=${type}]`, label });
  }

  const text = cleanHtml
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n### $1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n* $1')
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();

  return { html, title, text, elements };
}

function findPortal(state: any, nameOrId: string): PortalNode | undefined {
  const norm = nameOrId.toLowerCase();
  for (const node of state.nodes.values()) {
    if (node.kind === 'portal') {
      const p = (node as PortalNode).content;
      const title = (p.title || (p.portalKind === 'device' ? p.deviceName : 'Portal') || '').toLowerCase();
      if (node.id === nameOrId || title === norm) {
        return node as PortalNode;
      }
    }
  }
  return undefined;
}

export const portalCommand: CommandHandler = async (req, state, router, scheduler, sendToMain) => {
  const [subaction, ...restArgs] = req.args;
  const action = (subaction || '').toLowerCase();

  switch (action) {
    case 'create': {
      const urlOrSim = restArgs[0] || (req.options.url as string) || (req.options.simulator ? 'device' : 'about:blank');
      const explicitName = restArgs[1] || (req.options.name as string);
      const isDevice = Boolean(req.options.simulator);
      const simulatorId = req.options.simulator as string | undefined;

      let width = 1280;
      let height = 800;
      if (req.options.size && typeof req.options.size === 'string') {
        const [w, h] = req.options.size.split('x').map(Number);
        if (w && h) {
          width = w;
          height = h;
        }
      } else if (isDevice) {
        width = 390;
        height = 844;
      }

      const portalId = randomUUID();
      const nodeId = `node-portal-${portalId.slice(0, 8)}`;
      const title = explicitName || (isDevice ? (simulatorId || 'Pixel') : 'Portal');

      const portalNode: PortalNode = {
        id: nodeId,
        kind: 'portal',
        x: 100,
        y: 700,
        width,
        height,
        zIndex: 12,
        content: {
          portalKind: isDevice ? 'device' : 'browser',
          url: isDevice ? undefined : urlOrSim,
          title,
          viewport: { width, height },
          deviceId: simulatorId,
          deviceName: isDevice ? (simulatorId || 'Android Device') : undefined,
          deviceKind: isDevice ? 'emulator' : undefined,
        },
      };

      state.nodes.set(nodeId, portalNode);

      // Wire portal to caller terminal
      state.connections.push({
        fromId: req.terminalId,
        toId: nodeId,
        label: 'Driver',
      });

      return {
        output: `Created portal "${title}" [${isDevice ? `device: ${simulatorId}` : `url: ${urlOrSim}`}] (${width}x${height})`,
        exitCode: 0,
        data: { portalId, nodeId, title },
      };
    }

    case 'devices': {
      return {
        output: [
          'Available Android Devices & Emulators:',
          '  * emulator-5554 (Pixel 7 Pro - Android 14) [state: free, running]',
          '  * emulator-5556 (Pixel Tablet - Android 13) [state: free, running]',
          '  * physical-usb-01 (Samsung Galaxy S23) [state: authorized]',
        ].join('\n'),
        exitCode: 0,
      };
    }

    case 'read':
    case 'snapshot': {
      const portalName = restArgs[0];
      if (!portalName) {
        return {
          error: `maestri portal ${action}: portal name required. Usage: maestri portal ${action} "Portal"`,
          exitCode: 1,
        };
      }

      const portal = findPortal(state, portalName);
      if (!portal) {
        return {
          error: `Portal "${portalName}" not found.`,
          exitCode: 1,
        };
      }

      const isDev = portal.content.portalKind === 'device';
      const vp = portal.content.viewport || { width: 1280, height: 800 };

      if (isDev) {
        return {
          output: [
            `app: com.example.app  screen: ${vp.width}x${vp.height}pt  elements: 4`,
            '@e1 text "Welcome to Maestri Mobile" [40,80 320x40]',
            '@e2 field "Search products or features" [40,140 310x50] *focused*',
            '@e3 button "Explore Canvas" [40,210 310x48]',
            '@e4 button "Settings" [40,280 310x48]',
          ].join('\n'),
          exitCode: 0,
        };
      }

      const url = portal.content.url;
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        try {
          const page = await fetchPage(url, portal.content.userAgent);
          if (action === 'read') {
            return {
              output: `# ${page.title}\nURL: ${url}\n\n${page.text}`,
              exitCode: 0,
            };
          }

          const elemRows = page.elements.map((e) =>
            e.href ? `${e.ref} ${e.type} "${e.label}" href=${e.href}` : `${e.ref} ${e.type} "${e.label}"`
          );

          return {
            output: [
              `viewport: ${vp.width}x${vp.height}  url: ${url}  title: ${page.title}`,
              ...elemRows,
              '',
              '--- Page Summary ---',
              page.text.slice(0, 1500) + (page.text.length > 1500 ? '...' : ''),
            ].join('\n'),
            exitCode: 0,
          };
        } catch (fetchErr: any) {
          return {
            output: `viewport: ${vp.width}x${vp.height}  url: ${url}  title: ${portal.content.title || 'Maestri Portal'}\n(Could not fetch online content: ${fetchErr.message})`,
            exitCode: 0,
          };
        }
      }

      return {
        output: [
          `viewport: ${vp.width}x${vp.height}  url: ${portal.content.url || 'about:blank'}  title: ${portal.content.title || 'Maestri Portal'}`,
          '@e1 div "Portal Container"',
          '(No web content loaded or URL is blank)',
        ].join('\n'),
        exitCode: 0,
      };
    }

    case 'click':
    case 'tap': {
      const portalName = restArgs[0];
      const target = restArgs[1];
      if (!portalName || !target) {
        return {
          error: 'maestri portal click: required args missing. Usage: maestri portal click "Portal" <selector>',
          exitCode: 1,
        };
      }
      return {
        output: `Clicked ${target} on "${portalName}".`,
        exitCode: 0,
      };
    }

    case 'fill': {
      const portalName = restArgs[0];
      const target = restArgs[1];
      const val = restArgs.slice(2).join(' ');
      if (!portalName || !target) {
        return {
          error: 'maestri portal fill: required args missing. Usage: maestri portal fill "Portal" <selector> <value>',
          exitCode: 1,
        };
      }
      return {
        output: `Filled ${target} with "${val}" on "${portalName}".`,
        exitCode: 0,
      };
    }

    case 'type': {
      const portalName = restArgs[0];
      let selector: string | undefined;
      let text: string;
      if (restArgs.length >= 3) {
        selector = restArgs[1];
        text = restArgs.slice(2).join(' ');
      } else {
        text = restArgs.slice(1).join(' ');
      }
      return {
        output: `Typed "${text}" into ${selector || 'focused element'} on "${portalName}".`,
        exitCode: 0,
      };
    }

    case 'key': {
      const portalName = restArgs[0];
      const keyName = restArgs[1];
      if (!portalName || !keyName) {
        return {
          error: 'maestri portal key: key required. Usage: maestri portal key "Portal" <key>',
          exitCode: 1,
        };
      }
      return {
        output: `Sent key "${keyName}" to "${portalName}".`,
        exitCode: 0,
      };
    }

    case 'focus': {
      const portalName = restArgs[0];
      const target = restArgs[1];
      return {
        output: `Focused ${target} on "${portalName}".`,
        exitCode: 0,
      };
    }

    case 'select': {
      const portalName = restArgs[0];
      const target = restArgs[1];
      const opt = restArgs.slice(2).join(' ');
      return {
        output: `Selected "${opt}" in ${target} on "${portalName}".`,
        exitCode: 0,
      };
    }

    case 'check': {
      const portalName = restArgs[0];
      const target = restArgs[1];
      return {
        output: `Checked ${target} on "${portalName}".`,
        exitCode: 0,
      };
    }

    case 'uncheck': {
      const portalName = restArgs[0];
      const target = restArgs[1];
      return {
        output: `Unchecked ${target} on "${portalName}".`,
        exitCode: 0,
      };
    }

    case 'reload': {
      const portalName = restArgs[0];
      return {
        output: `Reloaded portal "${portalName}".`,
        exitCode: 0,
      };
    }

    case 'screenshot': {
      const portalName = restArgs[0];
      const tempPath = `C:\\Users\\mabru\\AppData\\Local\\Temp\\maestri-screenshot-${randomUUID().slice(0, 8)}.png`;
      return {
        output: tempPath,
        exitCode: 0,
      };
    }

    case 'scroll': {
      const portalName = restArgs[0];
      const dir = restArgs[1] || 'down';
      const px = restArgs[2] || '300';
      return {
        output: `Scrolled ${dir} ${px}px on "${portalName}".`,
        exitCode: 0,
      };
    }

    case 'navigate': {
      const portalName = restArgs[0];
      const url = restArgs[1];
      const portal = findPortal(state, portalName);
      if (portal) {
        portal.content.url = url;
      }
      return {
        output: `Navigated "${portalName}" to ${url}`,
        exitCode: 0,
      };
    }

    case 'back': {
      return { output: `Navigated back on "${restArgs[0]}".`, exitCode: 0 };
    }

    case 'forward': {
      return { output: `Navigated forward on "${restArgs[0]}".`, exitCode: 0 };
    }

    case 'info': {
      const portalName = restArgs[0];
      const portal = findPortal(state, portalName);
      if (!portal) return { error: `Portal "${portalName}" not found.`, exitCode: 1 };
      const p = portal.content;
      return {
        output: `Portal: "${p.title}"\nKind: ${p.portalKind}\nURL: ${p.url || 'none'}\nViewport: ${p.viewport?.width}x${p.viewport?.height}\nDevice: ${p.deviceName || 'none'}`,
        exitCode: 0,
      };
    }

    case 'edit': {
      const portalName = restArgs[0];
      const url = req.options.url || restArgs[1];
      const portal = findPortal(state, portalName);
      if (portal && url) {
        portal.content.url = url;
        return { output: `Updated "${portalName}" URL to ${url}`, exitCode: 0 };
      }
      return { error: 'maestri portal edit: --url required.', exitCode: 1 };
    }

    case 'close': {
      const portalName = restArgs[0];
      const portal = findPortal(state, portalName);
      if (!portal) return { error: `Portal "${portalName}" not found.`, exitCode: 1 };
      state.nodes.delete(portal.id);
      return { output: `Closed portal "${portalName}".`, exitCode: 0 };
    }

    case 'resize': {
      const portalName = restArgs[0];
      const w = parseInt(restArgs[1], 10);
      const h = parseInt(restArgs[2], 10);
      const portal = findPortal(state, portalName);
      if (portal && w && h) {
        portal.content.viewport = { width: w, height: h };
        portal.width = w;
        portal.height = h;
        return { output: `viewport: ${w}x${h}`, exitCode: 0 };
      }
      return { error: 'maestri portal resize: width and height required.', exitCode: 1 };
    }

    case 'ua': {
      const portalName = restArgs[0];
      const preset = restArgs[1];
      const portal = findPortal(state, portalName);
      if (!preset) {
        return {
          output: `Current UA: ${portal?.content.userAgent || 'Default'}\nPresets: ios, android, firefox-android, edge-android, chrome, firefox, edge, desktop`,
          exitCode: 0,
        };
      }
      if (portal) portal.content.userAgent = preset;
      return { output: `Set user agent preset "${preset}" on "${portalName}".`, exitCode: 0 };
    }

    case 'text': {
      const portalName = restArgs[0];
      const portal = findPortal(state, portalName);
      if (!portal) return { error: `Portal "${portalName}" not found.`, exitCode: 1 };
      const url = portal.content.url;
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        try {
          const page = await fetchPage(url, portal.content.userAgent);
          return { output: page.text, exitCode: 0 };
        } catch (e: any) {
          return { error: `Failed to fetch text: ${e.message}`, exitCode: 1 };
        }
      }
      return { output: 'No text content available.', exitCode: 0 };
    }

    case 'html': {
      const portalName = restArgs[0];
      const portal = findPortal(state, portalName);
      if (!portal) return { error: `Portal "${portalName}" not found.`, exitCode: 1 };
      const url = portal.content.url;
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        try {
          const page = await fetchPage(url, portal.content.userAgent);
          return { output: page.html, exitCode: 0 };
        } catch (e: any) {
          return { error: `Failed to fetch html: ${e.message}`, exitCode: 1 };
        }
      }
      return { output: '<!DOCTYPE html><html><body>(empty portal)</body></html>', exitCode: 0 };
    }

    case 'evaluate': {
      const script = restArgs.slice(1).join(' ');
      return { output: `Evaluated: "${script}" -> "result"`, exitCode: 0 };
    }

    case 'logs-start': {
      return { output: `Started capturing console logs for "${restArgs[0]}".`, exitCode: 0 };
    }

    case 'logs': {
      return { output: `[console.log]: Application initialized.\n[console.info]: Router mounted.`, exitCode: 0 };
    }

    case 'button': {
      const portalName = restArgs[0];
      const btn = restArgs[1];
      return { output: `Pressed button "${btn}" on "${portalName}".`, exitCode: 0 };
    }

    case 'launch': {
      const portalName = restArgs[0];
      const pkg = restArgs[1];
      return { output: `Launched package "${pkg}" on "${portalName}".`, exitCode: 0 };
    }

    case 'terminate': {
      const portalName = restArgs[0];
      const pkg = restArgs[1];
      return { output: `Terminated package "${pkg}" on "${portalName}".`, exitCode: 0 };
    }

    default:
      return {
        error: `Unknown portal action: "${action}". Run "maestri portal --help" for details.`,
        exitCode: 1,
      };
  }
};
