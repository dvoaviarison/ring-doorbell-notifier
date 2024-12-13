import "dotenv/config";
import ffmpeg from 'fluent-ffmpeg';
import { logger } from "../logHelper/index.mjs";

const { env } = process;

export async function takeSnapshotFromVideo(videoFileName, snapshotFileName) {  
    const videoFilePath = `${env.APP_RECORDING_FOLDER}/${videoFileName}`;
    const res = await new Promise((resolve) => {
        ffmpeg(videoFilePath)
            .screenshots({
                timestamps: [env.APP_SNAPSHOT_TIME_SEC],
                filename: snapshotFileName,
                folder: env.APP_RECORDING_FOLDER
            })
            .on('end', () => {
                resolve(true);
            })
            .on('error', (err) => {
                logger.info(err);
                resolve(false);
            });
    });

    return res;
}

export async function recordVideoFromCamera(camera, videoFileName, recordingDurationSec) {
    return await camera.recordToFile(`${env.APP_RECORDING_FOLDER}/${videoFileName}`, recordingDurationSec);
}