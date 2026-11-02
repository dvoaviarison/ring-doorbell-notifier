import { recordVideoFromCamera } from './index.mjs';

describe('recordVideoFromCamera', () => {
    beforeEach(() => {
        process.env.APP_RECORDING_FOLDER = '/recordings';
    });

    it('records a video to the requested file for the requested duration', async () => {
        const camera = {
            recordToFile: jest.fn().mockResolvedValue(undefined)
        };

        await expect(recordVideoFromCamera(camera, 'doorbell.mp4', 10))
            .resolves.toBeUndefined();

        expect(camera.recordToFile).toHaveBeenCalledWith('/recordings/doorbell.mp4', 10);
    });

    it('rejects when recording fails', async () => {
        const error = new Error('Recording failed');
        const camera = {
            recordToFile: jest.fn().mockRejectedValue(error)
        };

        await expect(recordVideoFromCamera(camera, 'doorbell.mp4', 10))
            .rejects.toBe(error);
    });
});
