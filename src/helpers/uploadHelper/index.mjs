import "dotenv/config";
import fs from 'fs';
import { Storage } from 'megajs'
import { stat } from 'fs/promises';
import { checkFileExists, purgeLocalFiles } from '../fileHelper/index.mjs';
import { trackPendingUpload } from '../pendingUploadHelper/index.mjs';

const { env } = process;

export function openMegaStorage(credentials) {
    if (typeof credentials?.email !== 'string' || !credentials.email ||
        typeof credentials?.password !== 'string' || !credentials.password) {
        throw new TypeError('MEGA email and password are required.');
    }
    return new Storage({
        email: credentials.email,
        password: credentials.password,
        userAgent: 'RingDoorbellNotifier'
    }).ready;
}

export async function uploadFileToMega(fileName, credentials) {
    const filePath = `${env.APP_RECORDING_FOLDER}/${fileName}`;
    const stopTracking = trackPendingUpload(filePath);

    try {
        const fileExists = await checkFileExists(filePath);
        if (fileExists) {
            const fileContent = fs.createReadStream(filePath);
            const stats = await stat(filePath);
            const storage = await openMegaStorage(credentials);

            const file = await storage.upload(
                {
                    name: fileName,
                    size : stats.size
                },
                fileContent).complete;
            return await file.link();
        }
    } finally {
        stopTracking();
        purgeLocalFiles();
    }
}
