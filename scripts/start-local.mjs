import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'..');
const localTunnel=join(root,'bin','tunnel-client');

function run(command) {
  return execSync(command, { stdio: 'inherit', env: process.env, cwd:root });
}

try {
  run('git rev-parse --is-inside-work-tree');
  console.log('\nScout Lab: checking GitHub for updates...');
  run('git pull --ff-only');
} catch (error) {
  console.warn('Scout Lab: GitHub auto-update was skipped; starting the local copy.');
}

let tunnel = null;
function stopTunnel() {
  if (tunnel && !tunnel.killed) tunnel.kill('SIGTERM');
}
process.once('SIGINT', () => {
  stopTunnel();
  process.exit(130);
});
process.once('SIGTERM', () => {
  stopTunnel();
  process.exit(143);
});
process.once('exit', stopTunnel);

// Start Scout Lab first so the private MCP endpoint is ready before tunnel-client connects.
await import('../src/node-server.mjs');

const tunnelProfile = String(process.env.SCOUT_TUNNEL_PROFILE || '').trim();
const tunnelCommand = existsSync(localTunnel) ? localTunnel : 'tunnel-client';

if (tunnelProfile) {
  const deadline=Date.now()+10000;
  while(Date.now()<deadline) {
    try {
      const r=await fetch('http://127.0.0.1:3100/healthz');
      if(r.ok) break;
    } catch (_) {}
    await new Promise((r)=>setTimeout(r,250));
  }

  console.log(`Scout Lab: starting OpenAI Secure MCP Tunnel profile "${tunnelProfile}"...`);
  tunnel = spawn(tunnelCommand, ['run', '--profile', tunnelProfile], {
    stdio: 'inherit',
    env: process.env,
    cwd:root
  });
  tunnel.on('error', (error) => {
    console.warn(`Scout Lab: Secure MCP Tunnel could not start: ${error.message}`);
  });
  tunnel.on('exit', (code, signal) => {
    if (code && code !== 0) console.warn(`Scout Lab: Secure MCP Tunnel exited with code ${code}.`);
    else if (signal) console.log(`Scout Lab: Secure MCP Tunnel stopped (${signal}).`);
  });
}
