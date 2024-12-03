import "dotenv/config";
import fs from 'fs';
import { Storage } from 'megajs'
import { stat } from 'fs/promises';

const { env } = process;

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
