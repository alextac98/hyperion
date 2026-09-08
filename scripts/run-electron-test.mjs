import { spawn } from 'node:child_process';
import electron from 'electron';
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['tests/electron-smoke.mjs'], { env: environment, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
child.on('error', error => { console.error(error); process.exitCode = 1; });
