import "dotenv/config";
import fs from 'fs';
import path from 'path';
import { sleep } from "../processHelper/index.mjs";
import { logger } from "../logHelper/index.mjs";

const { env } = process;

export function updateEnvValue(key, value, envPath = './.env') {
    process.env[key] = value;
    if (!fs.existsSync(envPath)) {
        logger.info(`Updated ${key} in the process environment; ${envPath} does not exist, skipping file write.`);
        return;
    }

    const envConfig = fs.readFileSync(envPath, 'utf-8');
    const escapedValue = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const updatedLine = `${key}='${escapedValue}'`;
    let found = false;
    const hasTrailingNewline = envConfig.endsWith('\n');
    const lines = envConfig.split('\n');
    if (hasTrailingNewline) {
        lines.pop();
    }

    const newEnvConfig = lines.map(line => {
        const [currentKey] = line.split('=');
        if (currentKey === key) {
            found = true;
            return updatedLine;
        }
        return line;
    });

    if (!found) {
        newEnvConfig.push(updatedLine);
    }

    fs.writeFileSync(envPath, `${newEnvConfig.join('\n')}${hasTrailingNewline ? '\n' : ''}`, 'utf-8');
    logger.info(`Updated ${key} in the environment file.`);
}

export function purgeLocalFiles(
    callback = () => { },
    folderPath = env.APP_RECORDING_FOLDER,
    extensions = ['.jpg', '.mp4']) {
    fs.readdir(folderPath, (err, files) => {
        if (err) {
            logger.error(`Error reading directory: ${err}`);
            return;
        }

        files.forEach((file) => {
            const filePath = path.join(folderPath, file);
            const fileExtension = path.extname(file).toLowerCase();

            if (extensions.includes(fileExtension)) {
                fs.unlink(filePath, (err) => {
                    if (err) {
                        logger.error(`Error deleting file: ${err}`);
                        return;
                    }
                    else {
                        logger.info(`File deleted successfully: ${filePath}`);
                    }

                    callback();
                });
            }
        });
    });
}

export async function checkFileExists(path, retries = 10, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        if (fs.existsSync(path)) {
            return true;
        }
        logger.info(`File not found. Retrying (${i + 1}/${retries})...`);
        await sleep(delay);
    }

    logger.info(`File not found after {retries} retries. Giving up`);
    return false;
}