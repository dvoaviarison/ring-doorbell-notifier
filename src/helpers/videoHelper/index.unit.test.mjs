import { recordVideoFromCamera } from './index.mjs';

describe('recordVideoFromCamera', () => {
    beforeEach(() => {
        process.env.APP_RECORDING_FOLDER = '/recordings';
    });

    it('buffers incoming packets and repairs missing timestamps while recording', async () => {
        const unsubscribe = jest.fn();
        const camera = {
            streamVideo: jest.fn().mockResolvedValue({
                onCallEnded: {
                    subscribe: jest.fn((observer) => {
                        observer.next();
                        return { unsubscribe };
                    })
                }
            })
        };

        await expect(recordVideoFromCamera(camera, 'doorbell.mp4', 10))
            .resolves.toBeUndefined();

        expect(camera.streamVideo).toHaveBeenCalledWith({
            input: ['-thread_queue_size', '512', '-fflags', '+genpts'],
            video: [
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-crf', '20',
                '-fps_mode', 'cfr'
            ],
            output: ['-t', '10', '/recordings/doorbell.mp4']
        });
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('rejects when the recording stream ends with an error', async () => {
        const error = new Error('Recording stream failed');
        const unsubscribe = jest.fn();
        const camera = {
            streamVideo: jest.fn().mockResolvedValue({
                onCallEnded: {
                    subscribe: jest.fn((observer) => {
                        observer.error(error);
                        return { unsubscribe };
                    })
                }
            })
        };

        await expect(recordVideoFromCamera(camera, 'doorbell.mp4', 10))
            .rejects.toBe(error);
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});
