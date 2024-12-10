import "dotenv/config";
import fs from 'fs';
import path from 'path';
import { sleep } from "../processHelper/index.mjs";
import { logger } from "../logHelper/index.mjs";

const { env } = process;

export function updateEnvValue(key, value, envPath = './.env') {
    const envConfig = fs.readFileSync(envPath, 'utf-8');

    // Split lines and update the value
    const newEnvConfig = envConfig.split('\n').map(line => {
        const [currentKey, _] = line.split('=');
        if (currentKey === key) {
            return `${key}='${value}'`;
        }
        return line;
    }).join('\n');

    // Write updated values back to the .env file
    fs.writeFileSync(envPath, newEnvConfig, 'utf-8');
    process.env[key] = value;
    console.log(`Updated ${key} to ${value}`);
}

export function purgeLocalFiles(
    callback = () => {},
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