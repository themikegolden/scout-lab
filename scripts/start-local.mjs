import { execSync } from 'node:child_process';

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

await import('../src/node-server.mjs');
