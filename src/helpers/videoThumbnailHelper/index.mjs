import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function createVideoThumbnail(videoFileName) {
    const folder = process.env.APP_RECORDING_FOLDER;
    if (!folder) {
        throw new Error('APP_RECORDING_FOLDER must be configured to generate video thumbnails.');
    }

    if (path.extname(videoFileName).toLowerCase() !== '.mp4') {
        throw new Error('Video thumbnails can only be generated from MP4 recordings.');
    }

    const thumbnailFileName = `${path.basename(videoFileName, path.extname(videoFileName))}.jpg`;
    const videoPath = path.join(folder, videoFileName);
    const thumbnailPath = path.join(folder, thumbnailFileName);
    const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

    await execFileAsync(ffmpegPath, [
        '-hide_banner',
        '-loglevel', 'error',
        '-ss', '0.5',
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', 'scale=320:-2',
        '-q:v', '5',
        '-y', thumbnailPath
    ]);

    const thumbnail = await stat(thumbnailPath);
    if (thumbnail.size === 0) {
        throw new Error('FFmpeg generated an empty video thumbnail.');
    }

    return thumbnailFileName;
}
