import "dotenv/config";
import fs from 'fs';
import path from 'path';
import { sleep } from "../processHelper/index.mjs";

const { env } = process;

export function purgeLocalFiles(
    callback = () => {},
    folderPath = env.APP_RECORDING_FOLDER, 
    extensions = ['.jpg', '.mp4']) {
    fs.readdir(folderPath, (err, files) => {
        if (err) {
            console.error(`Error reading directory: ${err}`);
            return;
        }

        files.forEach((file) => {
            const filePath = path.join(folderPath, file);
            const fileExtension = path.extname(file).toLowerCase();

            if (extensions.includes(fileExtension)) {
                fs.unlink(filePath, (err) => {
                    if (err) {
                        console.error(`Error deleting file: ${err}`);
                        return;
                    }
                    else {
                        console.log(`File deleted successfully: ${filePath}`);
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
        console.log(`File not found. Retrying (${i + 1}/${retries})...`);
        await sleep(delay);
    }

    console.log(`File not found after {retries} retries. Giving up`);
    return false;
}