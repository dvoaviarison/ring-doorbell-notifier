import "dotenv/config";
import fs from 'fs';
import { Storage } from 'megajs'
import { stat } from 'fs/promises';

const { env } = process;

async function checkFileExists(path, retries = 10, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        if (fs.existsSync(path)) {
            return true;
        }
        console.log(`File not found. Retrying (${i + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    console.log(`File not found after {retries} retries. Giving up`);
    return false;
}

export async function uploadFileToMega(fileName) {
    const filePath = `${env.APP_RECORDING_FOLDER}/${fileName}`;
    const fileExists = await checkFileExists(filePath);
    if (fileExists) {
        const fileContent = fs.createReadStream(filePath);
        const stats = await stat(filePath);
        const storage = await new Storage({
            email: env.MEGA_EMAIL,
            password: env.MEGA_PASSWORD,
            userAgent: 'RingDoorbellNotifier'
        }).ready;

        const file = await storage.upload(
            {
                name: fileName,
                size : stats.size
            },
            fileContent).complete;
        var link = await file.link();
        return link;       
    }
}
