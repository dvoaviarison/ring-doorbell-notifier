import { getVideoDescriptionViaGemini } from './index.mjs';
import { logger } from '../logHelper/index.mjs';

describe('getVideoDescriptionViaGemini', () => {
    test('should describe the video via Gemini AI', async () => {
        // Act
        const result = await getVideoDescriptionViaGemini('recording.test.mp4', 'Front Door');

        // Assert
        logger.info(result);
        expect(result).not.toBeNull();
    }, 350000);
});
