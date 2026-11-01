import fs from 'fs';
import os from 'os';
import path from 'path';
import { updateEnvValue } from './index.mjs';

describe('updateEnvValue', () => {
  let directory;
  let envPath;
  const previousToken = process.env.RING_REFRESH_TOKEN;
  const previousSetting = process.env.APP_SETTING;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-notifier-env-'));
    envPath = path.join(directory, '.env');
    fs.writeFileSync(envPath, 'APP_SETTING=value\n');
  });

  afterEach(() => {
    if (previousToken === undefined) {
      delete process.env.RING_REFRESH_TOKEN;
    } else {
      process.env.RING_REFRESH_TOKEN = previousToken;
    }
    if (previousSetting === undefined) {
      delete process.env.APP_SETTING;
    } else {
      process.env.APP_SETTING = previousSetting;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('updates existing environment values without changing other settings', () => {
    updateEnvValue('APP_SETTING', 'updated', envPath);

    expect(fs.readFileSync(envPath, 'utf8')).toBe("APP_SETTING='updated'\n");
    expect(process.env.APP_SETTING).toBe('updated');
  });

  test('adds a missing token setting', () => {
    updateEnvValue('RING_REFRESH_TOKEN', 'test-token', envPath);

    expect(fs.readFileSync(envPath, 'utf8')).toBe("APP_SETTING=value\nRING_REFRESH_TOKEN='test-token'\n");
    expect(process.env.RING_REFRESH_TOKEN).toBe('test-token');
  });

  test('updates the process environment when the environment file does not exist', () => {
    const missingEnvPath = path.join(directory, 'missing.env');

    updateEnvValue('RING_REFRESH_TOKEN', 'runtime-token', missingEnvPath);

    expect(process.env.RING_REFRESH_TOKEN).toBe('runtime-token');
    expect(fs.existsSync(missingEnvPath)).toBe(false);
  });
});
