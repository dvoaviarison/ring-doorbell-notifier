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
    const stream = await camera.streamVideo({
        input: ['-thread_queue_size', '512', '-fflags', '+genpts'],
        output: [
            '-t',
            recordingDurationSec.toString(),
            `${env.APP_RECORDING_FOLDER}/${videoFileName}`
        ]
    });

    await new Promise((resolve, reject) => {
        let subscription;
        let settled = false;
        const unsubscribe = () => subscription?.unsubscribe();
        const finish = (callback, value) => {
            settled = true;
            unsubscribe();
            callback(value);
        };

        subscription = stream.onCallEnded.subscribe({
            next: () => finish(resolve),
            error: (error) => finish(reject, error)
        });

        if (settled) {
            unsubscribe();
        }
    });
}