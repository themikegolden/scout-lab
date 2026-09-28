import { execSync, spawn } from 'node:child_process';

function run(command) {
  return execSync(command, { stdio: 'inherit', env: process.env });
}

try {
  run('git rev-parse --is-inside-work-tree');
  console.log('\nScout Lab: checking GitHub for updates...');
  run('git pull --ff-only');
} catch (error) {
  console.warn('Scout Lab: GitHub auto-update was skipped; starting the local copy.');
}

let tunnel = null;
const tunnelProfile = String(process.env.SCOUT_TUNNEL_PROFILE || '').trim();

if (tunnelProfile) {
  console.log(`Scout Lab: starting OpenAI Secure MCP Tunnel profile "${tunnelProfile}"...`);
  tunnel = spawn('tunnel-client', ['run', '--profile', tunnelProfile], {
    stdio: 'inherit',
    env: process.env
  });
  tunnel.on('error', (error) => {
    console.warn(`Scout Lab: Secure MCP Tunnel could not start: ${error.message}`);
  });
  tunnel.on('exit', (code, signal) => {
    if (code && code !== 0) console.warn(`Scout Lab: Secure MCP Tunnel exited with code ${code}.`);
    else if (signal) console.log(`Scout Lab: Secure MCP Tunnel stopped (${signal}).`);
  });
}

function stopTunnel() {
  if (tunnel && !tunnel.killed) tunnel.kill('SIGTERM');
}
process.once('SIGINT', stopTunnel);
process.once('SIGTERM', stopTunnel);
process.once('exit', stopTunnel);

await import('../src/node-server.mjs');
