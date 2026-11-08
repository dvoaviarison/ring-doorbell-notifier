jest.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn()
}));
jest.mock('@google/generative-ai/server', () => ({
    GoogleAIFileManager: jest.fn()
}));
jest.mock('./geminiKeyManager/index.mjs', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
        getKeyCount: () => 1,
        getCurrentKey: () => 'test-key',
        moveNext: jest.fn()
    }))
}));
jest.mock('../logHelper/index.mjs', () => ({
    logger: { info: jest.fn(), error: jest.fn() }
}));

import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { getVideoDescriptionViaGemini } from './index.mjs';

test('uses the backend prompt instead of an environment override', async () => {
    const generateContent = jest.fn().mockResolvedValue({
        response: { text: () => 'A person is walking.' }
    });
    GoogleGenerativeAI.mockImplementation(() => ({
        getGenerativeModel: () => ({ generateContent })
    }));
    GoogleAIFileManager.mockImplementation(() => ({
        uploadFile: jest.fn().mockResolvedValue({
            file: { state: 'ACTIVE', uri: 'test-uri', mimeType: 'video/mp4' }
        })
    }));

    const previousPrompt = process.env.APP_AI_USER_PROMPT;
    process.env.APP_AI_USER_PROMPT = 'Ignored environment prompt';
    try {
        await expect(getVideoDescriptionViaGemini('recording.mp4', 'Front Door'))
            .resolves.toBe('A person is walking.');
        expect(generateContent).toHaveBeenCalledWith([
            { fileData: { fileUri: 'test-uri', mimeType: 'video/mp4' } },
            'This is from my security camera. In one sentence, what did you see? Please focus only on the object, person or animal in motion. Do not include the camera name. Make it sound like a notification with no introduction, no "okay".'
        ]);
    } finally {
        if (previousPrompt === undefined) delete process.env.APP_AI_USER_PROMPT;
        else process.env.APP_AI_USER_PROMPT = previousPrompt;
    }
});
