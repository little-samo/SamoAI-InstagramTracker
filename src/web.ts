import path from 'path';
import http from 'http';
import url from 'url';
import { spawn } from 'child_process';

import {
  LocationId,
  SamoAI,
  UserId,
  LocationMessage,
  EntityType,
  Location,
  AgentId,
  Agent,
} from '@little-samo/samo-ai';
import {
  AgentStorage,
  GimmickStorage,
  ItemStorage,
  LocationStorage,
  UserStorage,
} from '@little-samo/samo-ai-repository-storage';
import * as dotenv from 'dotenv';

import * as packageJson from '../package.json';

// Import Chrome actions to register them
import './actions';
import { launchChromeBrowser, closeChromeBrowser, createNewTab } from './actions/chrome-actions';

dotenv.config();

interface ChatOptions {
  agents: string;
  location: string;
}

interface InfluencerItem {
  username: string;
  name: string;
  bio?: string;
  followers?: string;
  following?: string;
}

/**
 * Main application entry point
 * Sets up dependencies and starts the web server
 */
async function bootstrap() {
  // Add SIGINT handler for graceful shutdown
  process.on('SIGINT', async () => {
    try {
      await closeChromeBrowser();
    } catch (error) {
      console.error('Error closing browser:', error);
    }
    console.log('Exiting...');
    process.exit(0);
  });

  const agentStorage = new AgentStorage(
    path.join(process.cwd(), 'models', 'agents'),
    path.join(process.cwd(), 'states', 'agents')
  );
  const gimmickStorage = new GimmickStorage(
    path.join(process.cwd(), 'states', 'gimmicks')
  );
  const itemStorage = new ItemStorage(
    path.join(process.cwd(), 'states', 'items')
  );
  const locationStorage = new LocationStorage(
    path.join(process.cwd(), 'models', 'locations'),
    path.join(process.cwd(), 'states', 'locations')
  );
  const userStorage = new UserStorage(
    path.join(process.cwd(), 'models', 'users'),
    path.join(process.cwd(), 'states', 'users')
  );

  SamoAI.initialize({
    agentRepository: agentStorage,
    gimmickRepository: gimmickStorage,
    itemRepository: itemStorage,
    locationRepository: locationStorage,
    userRepository: userStorage,
  });

  // Default options for web server
  const options: ChatOptions = {
    agents: 'samo,nyx',
    location: 'instagram_parsing'
  };

  // Initialize storages
  const agents = options.agents.split(',');
  await locationStorage.initialize([options.location]);
  await agentStorage.initialize(agents);
  await userStorage.initialize(['user']);

  const locationId = Number(
    locationStorage.getLocationIds()[0]
  ) as LocationId;
  const userId = Number(userStorage.getUserIds()[0]) as UserId;
  const userName = (await userStorage.getUserModel(userId)).nickname;

  // Initialize state cleanup
  const locationState =
    await locationStorage.getOrCreateLocationState(locationId);
  for (const locationUserId of locationState.userIds) {
    await locationStorage.removeLocationStateUserId(
      locationId,
      locationUserId
    );
  }
  for (const locationAgentId of locationState.agentIds) {
    await locationStorage.removeLocationStateAgentId(
      locationId,
      locationAgentId
    );
  }
  await locationStorage.addLocationStateUserId(locationId, userId);
  for (const agentId of agentStorage.getAgentIds()) {
    await locationStorage.addLocationStateAgentId(
      locationId,
      Number(agentId) as AgentId
    );
  }

  // Start web server
  async function startWebServer() {

      const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SamoAI Web UI</title>
  <style>
    html, body { height: 100%; margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial, sans-serif; background:#0b1220; color:#dbeafe; }
    .container { display:flex; height:100%; }
    .sidebar { width: 360px; border-right: 1px solid #1f2a44; overflow:auto; }
    .content { flex:1; display:flex; flex-direction:column; }
    .header { padding:12px 16px; border-bottom:1px solid #1f2a44; display:flex; align-items:center; gap:8px; }
    .title { font-weight:700; color:#93c5fd; }
    .list { padding:8px; display:grid; gap:8px; }
    .card { background:#111827; border:1px solid #1f2a44; border-radius:8px; padding:10px; cursor:pointer; }
    .card:hover { border-color:#264081; background:#0e1629; }
    .name { font-weight:600; color:#bfdbfe; }
    .meta { color:#9ca3af; font-size:12px; margin-top:4px; }
    .messages { flex:1; overflow:auto; padding:12px; display:flex; flex-direction:column; gap:10px; }
    .msg { background:#0f172a; border:1px solid #1f2a44; border-radius:8px; padding:10px; }
    .msg .from { font-weight:600; color:#93c5fd; margin-bottom:4px; }
    .thinking { padding:8px 12px; border-top:1px solid #1f2a44; background:#0f172a; }
    .thinking-content { display:flex; align-items:center; gap:8px; color:#93c5fd; font-size:14px; }
    .thinking-spinner { animation:spin 1s linear infinite; }
    .thinking-dots { animation:blink 1.5s infinite; }
    @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
    @keyframes blink { 0%,50%{opacity:1} 51%,100%{opacity:0.3} }
    .input { display:flex; gap:8px; padding:12px; border-top:1px solid #1f2a44; }
    input[type=text] { flex:1; padding:10px 12px; border-radius:8px; border:1px solid #1f2a44; background:#0f172a; color:#e5e7eb; }
    button { padding:10px 14px; border-radius:8px; border:1px solid #1f2a44; background:#1d4ed8; color:white; font-weight:600; cursor:pointer; }
    button:disabled { opacity:.5; cursor:not-allowed; }
  </style>
  </head>
  <body>
    <div class="container">
      <aside class="sidebar">
        <div class="header">
          <div class="title">Influencers</div>
        </div>
        <div id="influencers" class="list"></div>
      </aside>
      <main class="content">
        <div class="header">
          <div class="title">Chat - ${agents.join(', ')} @ ${options.location}</div>
        </div>
        <div id="messages" class="messages"></div>
        <div id="thinking" class="thinking" style="display:none;">
          <div class="thinking-content">
            <span class="thinking-spinner">⏳</span>
            <span id="thinking-agent">Agent</span> is thinking<span class="thinking-dots">...</span>
          </div>
        </div>
        <div class="input">
          <input id="text" type="text" placeholder="Enter your message..." />
          <button id="send">Send</button>
        </div>
      </main>
    </div>
    <script>
      async function fetchJson(u, opt){
        const r = await fetch(u, opt);
        return await r.json();
      }
      function el(t, cls, txt){ const e=document.createElement(t); if(cls) e.className=cls; if(txt) e.textContent=txt; return e; }
      // Auto-scroll to bottom state management
      let stickToBottom = true;
      function isNearBottom(el){
        if(!el) return true;
        const threshold = 8; // px
        return el.scrollHeight - (el.scrollTop + el.clientHeight) <= threshold;
      }
      function renderMessages(list){
        const root = document.getElementById('messages');
        const shouldScroll = isNearBottom(root) && stickToBottom;
        root.innerHTML='';
        (list||[]).forEach(m=>{
          if(!m || !m.message || !m.name) return;
          const card = el('div','msg');
          card.appendChild(el('div','from',m.name));
          const body = el('div','');
          body.textContent = m.message;
          card.appendChild(body);
          root.appendChild(card);
        });
        if (shouldScroll) {
          root.scrollTop = root.scrollHeight;
        }
      }
      function renderInfluencers(res){
        const { influencers } = res||{};
        const arr = Array.isArray(influencers)? influencers : [];
        const root = document.getElementById('influencers');
        root.innerHTML='';
        arr.forEach((it)=>{
          const c = el('div','card');
          const username = it?.username || it?.handle || it?.id || 'unknown';
          const displayName = it?.name || username;
          
          // Display handle name
          c.appendChild(el('div','name', '@' + username));
          
          // Display name if different from handle
          if (displayName && displayName !== username) {
            const nameEl = el('div','name');
            nameEl.style.fontSize = '14px';
            nameEl.style.color = '#e5e7eb';
            nameEl.textContent = displayName;
            c.appendChild(nameEl);
          }
          
          // Display bio information
          if (it?.bio) {
            const bioEl = el('div','meta');
            bioEl.style.fontSize = '11px';
            bioEl.style.color = '#9ca3af';
            bioEl.style.marginTop = '4px';
            bioEl.style.lineHeight = '1.3';
            bioEl.textContent = it.bio;
            c.appendChild(bioEl);
          }
          
          // Follower/following info (display if available, show card anyway)
          const meta = [];
          if (it?.followers !== undefined && it?.followers !== null) {
            meta.push('Followers: ' + it.followers);
          }
          if (it?.following !== undefined && it?.following !== null) {
            meta.push('Following: ' + it.following);
          }
          if (meta.length) {
            const metaEl = el('div','meta');
            metaEl.style.marginTop = '6px';
            metaEl.textContent = meta.join(' · ');
            c.appendChild(metaEl);
          } else {
            // 팔로워 정보가 없어도 기본 정보 표시
            const metaEl = el('div','meta');
            metaEl.style.marginTop = '6px';
            metaEl.style.color = '#6b7280';
            metaEl.textContent = 'No info';
            c.appendChild(metaEl);
          }
          
          // Open Instagram profile in new tab on click
          c.setAttribute('role','link');
          c.title = 'instagram.com/' + username;
          c.addEventListener('click', ()=>{
            const url = 'https://instagram.com/' + username;
            window.open(url, '_blank', 'noopener');
          });

          root.appendChild(c);
        });
      }
      function renderThinking(thinking){
        const thinkingEl = document.getElementById('thinking');
        const agentEl = document.getElementById('thinking-agent');
        const messagesEl = document.getElementById('messages');
        
        if (thinking && thinking.agentName) {
          thinkingEl.style.display = 'block';
          agentEl.textContent = thinking.agentName;
          // Auto-scroll to bottom when thinking starts (if user was at bottom)
          if (stickToBottom && messagesEl) {
            setTimeout(() => {
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }, 10);
          }
        } else {
          thinkingEl.style.display = 'none';
        }
      }
      async function load(){
        const [msgs, infl, thinking] = await Promise.all([
          fetchJson('/api/messages'),
          fetchJson('/api/influencers'),
          fetchJson('/api/thinking')
        ]);
        renderMessages(msgs);
        renderInfluencers(infl);
        renderThinking(thinking);
        
        // Ensure scroll to bottom if user was at bottom and thinking state changed
        if (stickToBottom) {
          const messagesEl = document.getElementById('messages');
          if (messagesEl) {
            setTimeout(() => {
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }, 10);
          }
        }
      }
      async function send(){
        const input = document.getElementById('text');
        const btn = document.getElementById('send');
        const text = (input.value||'').trim();
        if(!text) return;
        btn.disabled = true;
        try{
          await fetchJson('/api/message', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text }) });
          input.value='';
          // Auto-scroll to bottom when sending
          stickToBottom = true;
          setTimeout(load, 300);
        }finally{ btn.disabled=false; }
      }
      document.getElementById('send').addEventListener('click', send);
      document.getElementById('text').addEventListener('keydown', (e)=>{ if(e.key==='Enter') send(); });
      // Update auto-scroll state on scroll event
      (function(){
        const messagesEl = document.getElementById('messages');
        if (messagesEl) {
          messagesEl.addEventListener('scroll', ()=>{ stickToBottom = isNearBottom(messagesEl); });
        }
      })();
      load();
      setInterval(load, 1500);
    </script>
  </body>
</html>`;

      function sendJson(res: http.ServerResponse, body: unknown, status = 200) {
        const buf = Buffer.from(JSON.stringify(body));
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': buf.length,
        });
        res.end(buf);
      }

      const server = http.createServer(async (req, res) => {
        const parsed = url.parse(req.url || '/', true);
        const pathname = parsed.pathname || '/';

        if (req.method === 'GET' && pathname === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(indexHtml);
          return;
        }

        if (req.method === 'GET' && pathname === '/api/messages') {
          const messages = await locationStorage.getLocationMessages(locationId, 200);
          sendJson(res, messages || []);
          return;
        }

        if (req.method === 'GET' && pathname === '/api/thinking') {
          // Get current thinking agent from location state
          try {
            const statePath = path.join(process.cwd(), 'states', 'locations', `${options.location}.json`);
            const fs = await import('fs/promises');
            const raw = await fs.readFile(statePath, 'utf-8');
            const json = JSON.parse(raw);
            const thinkingAgent = json?.state?.thinkingAgentName || null;
            sendJson(res, { agentName: thinkingAgent });
          } catch (e) {
            sendJson(res, { agentName: null });
          }
          return;
        }

        if (req.method === 'POST' && pathname === '/api/message') {
          const chunks: Buffer[] = [];
          req.on('data', (c) => chunks.push(Buffer.from(c)));
          req.on('end', async () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { text?: string };
              const text = (body.text || '').trim();
              if (!text) { sendJson(res, { ok:false, error:'Empty message' }, 400); return; }
              await SamoAI.instance.addLocationUserMessage(locationId, userId, userName, text);
              await locationStorage.updateLocationStatePauseUpdateUntil(
                locationId,
                new Date(Date.now() + 500)
              );
              sendJson(res, { ok:true });
            } catch (e) {
              sendJson(res, { ok:false, error:String(e) }, 500);
            }
          });
          return;
        }

        if (req.method === 'GET' && pathname === '/api/influencers') {
          try {
            const statePath = path.join(process.cwd(), 'states', 'locations', `${options.location}.json`);
            const fs = await import('fs/promises');
            const raw = await fs.readFile(statePath, 'utf-8');
            const json = JSON.parse(raw);

            // Exact path: state.canvases.influencers.text
            const textBlob: string = String(json?.state?.canvases?.influencers?.text || '');
            
            let influencers: InfluencerItem[] = [];
            
            if (textBlob.trim()) {
              // Split by line breaks
              const lines = textBlob.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
              
              influencers = lines.map((line): InfluencerItem => {
                
                // Parse @handle | name | followers: N | following: M format
                const parts = line.split('|').map(p => p.trim());
                const handlePart = parts[0] || '';
                const namePart = parts[1] || '';
                
                const followersMatch = line.match(/followers:\s*([\d,\.]+[km]?)/i);
                const followingMatch = line.match(/following:\s*([\d,\.]+[km]?)/i);
                
                const username = handlePart.startsWith('@') ? handlePart.slice(1) : handlePart;
                
                // Keep original format (37k, 1.2m, etc.) instead of converting to numbers
                const followers = followersMatch ? followersMatch[1] : undefined;
                const following = followingMatch ? followingMatch[1] : undefined;
                
                // Extract bio from name part (if there's a long description)
                const bio = namePart.length > 15 ? namePart : '';
                const displayName = namePart.length > 15 ? username : namePart;
                
                const result: InfluencerItem = {
                  username,
                  name: displayName || username,
                  bio: bio,
                  followers,
                  following,
                };
                return result;
              }).filter((item) => item.username && item.username.trim());
            }

            sendJson(res, { influencers });
          } catch (e) {
            sendJson(res, { influencers: [], error: String(e) }, 200);
          }
          return;
        }

        res.statusCode = 404;
        res.end('Not Found');
      });

      const port = Number(process.env.PORT || 5173);
      // Automatically launch agent browser (Puppeteer) with multiple tabs
      try {
        console.log('Launching automation browser...');
        await launchChromeBrowser('https://www.instagram.com/', 'post_list');
        console.log('Automation browser launched with post_list tab.');
        
        // Create post&profile tab
        await createNewTab('post_profile', 'https://www.instagram.com/');
        console.log('Created post_profile tab.');
      } catch (e) {
        console.log('Failed to launch automation browser:', e);
      }

      server.listen(port, () => {
        const uiUrl = `http://localhost:${port}`;
        console.log(`Web UI: ${uiUrl}`);
        // Auto-open UI in default browser (cross-platform)
        const { platform } = process;
        try {
          if (platform === 'win32') {
            spawn('cmd', ['/c', 'start', '', uiUrl], { detached: true, stdio: 'ignore' }).unref();
          } else if (platform === 'darwin') {
            spawn('open', [uiUrl], { detached: true, stdio: 'ignore' }).unref();
          } else {
            spawn('xdg-open', [uiUrl], { detached: true, stdio: 'ignore' }).unref();
          }
        } catch {}
      });

      const updateLoop = async () => {
        while (true) {
          try {
            const locationState = await locationStorage.getOrCreateLocationState(locationId);
            const now = new Date();
            if (
              locationState.pauseUpdateUntil &&
              new Date(locationState.pauseUpdateUntil) <= now
            ) {
              await SamoAI.instance.updateLocation(userId, locationId, {
                preAction: async (location: Location) => {
                  // Track thinking agents
                  location.on('agentExecuteNextActions', async (agent: Agent) => {
                    // Update thinking state in location state
                    try {
                      const statePath = path.join(process.cwd(), 'states', 'locations', `${options.location}.json`);
                      const fs = await import('fs/promises');
                      const raw = await fs.readFile(statePath, 'utf-8');
                      const json = JSON.parse(raw);
                      json.state.thinkingAgentName = agent.model.name;
                      await fs.writeFile(statePath, JSON.stringify(json, null, 2));
                    } catch (e) {
                      // Ignore errors
                    }
                  });
                  
                  // Clear thinking state when agent responds
                  location.on('messageAdded', async (_loc: Location, message: LocationMessage) => {
                    if (message.entityType !== EntityType.User && message.name) {
                      try {
                        const statePath = path.join(process.cwd(), 'states', 'locations', `${options.location}.json`);
                        const fs = await import('fs/promises');
                        const raw = await fs.readFile(statePath, 'utf-8');
                        const json = JSON.parse(raw);
                        if (json.state.thinkingAgentName === message.name) {
                          json.state.thinkingAgentName = null;
                          await fs.writeFile(statePath, JSON.stringify(json, null, 2));
                        }
                      } catch (e) {
                        // Ignore errors
                      }
                    }
                  });
                },
                handleSave: async (save) => { try { await save; } catch {} },
              });
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      };

      void updateLoop();
    } 

  // Start the web server
  await startWebServer();
}

void bootstrap();
