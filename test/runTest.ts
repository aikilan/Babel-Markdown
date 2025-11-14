import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    const workspacePath = path.resolve(__dirname, '..', '..');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions', workspacePath],
    });
  } catch (error) {
    console.error('Failed to run extension tests');
    if (error) {
      console.error(error);
    }
    process.exit(1);
  }
}

void main();
