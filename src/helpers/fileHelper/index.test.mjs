import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../logHelper/index.mjs';
import { purgeLocalFiles, updateEnvValue } from './index.mjs';

describe('updateEnvValue', () => {
  let directory;
  let envPath;
  const previousSetting = process.env.APP_SETTING;
  const previousNewSetting = process.env.APP_SETTING_NEW;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-notifier-env-'));
    envPath = path.join(directory, '.env');
    fs.writeFileSync(envPath, 'APP_SETTING=value\n');
  });

  describe('purgeLocalFiles', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('ignores a file already removed by a concurrent cleanup', async () => {
      const alreadyDeleted = Object.assign(new Error('File not found'), { code: 'ENOENT' });
      const logError = jest.spyOn(logger, 'error');
      jest.spyOn(fs, 'readdir').mockImplementation((_folder, callback) => {
        callback(null, ['recording.mp4']);
      });
      jest.spyOn(fs, 'unlink').mockImplementation((_filePath, callback) => {
        callback(alreadyDeleted);
      });

      purgeLocalFiles(undefined, '/recordings');
      await new Promise(setImmediate);

      expect(logError).not.toHaveBeenCalled();
    });
  });

  afterEach(() => {
    if (previousSetting === undefined) {
      delete process.env.APP_SETTING;
    } else {
      process.env.APP_SETTING = previousSetting;
    }
    if (previousNewSetting === undefined) {
      delete process.env.APP_SETTING_NEW;
    } else {
      process.env.APP_SETTING_NEW = previousNewSetting;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('updates existing environment values without changing other settings', () => {
    updateEnvValue('APP_SETTING', 'updated', envPath);

    expect(fs.readFileSync(envPath, 'utf8')).toBe("APP_SETTING='updated'\n");
    expect(process.env.APP_SETTING).toBe('updated');
  });

  test('adds a missing environment setting', () => {
    updateEnvValue('APP_SETTING_NEW', 'new-value', envPath);

    expect(fs.readFileSync(envPath, 'utf8')).toBe("APP_SETTING=value\nAPP_SETTING_NEW='new-value'\n");
    expect(process.env.APP_SETTING_NEW).toBe('new-value');
  });

  test('updates the process environment when the environment file does not exist', () => {
    const missingEnvPath = path.join(directory, 'missing.env');

    updateEnvValue('APP_SETTING_NEW', 'runtime-value', missingEnvPath);

    expect(process.env.APP_SETTING_NEW).toBe('runtime-value');
    expect(fs.existsSync(missingEnvPath)).toBe(false);
  });
});
