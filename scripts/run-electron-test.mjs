import { spawn } from 'node:child_process';
import { desktopRuntime } from './desktop-runtime.mjs';
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(await desktopRuntime(), ['tests/electron-smoke.mjs'], { env: environment, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
child.on('error', error => { console.error(error); process.exitCode = 1; });
