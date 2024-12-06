import "dotenv/config";
import fs from 'fs';
import path from 'path';

const { env } = process;

function sleep(ms) { 
    return new Promise(resolve => setTimeout(resolve, ms)); 
}

export function purgeLocalFiles(
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
                    console.log(`File deleted successfully: ${filePath}`);
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