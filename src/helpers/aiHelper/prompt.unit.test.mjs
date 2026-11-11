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
import { prompts } from './prompts.mjs';

test('prompt limits person events to people approaching or close to the house', () => {
    expect(prompts.videoDescription).toContain('Use "person" only when at least one person is visibly approaching or is close to the house');
    expect(prompts.videoDescription).toContain('People only walking past at a distance');
    expect(prompts.videoDescription).toContain('do not qualify as "person"');
    expect(prompts.videoDescription).toContain('including a distant passerby alone');
    expect(prompts.videoDescription).toContain('If it is unclear whether anyone is approaching or close to the house, do not assume they are');
});

test('prompt prioritizes visible trash or recycling trucks even when passing', () => {
    expect(prompts.videoDescription).toContain('garbage, trash collection, or recycling truck is visible, even if it is only passing by');
    expect(prompts.videoDescription).toContain('Do not assume a truck collects trash or recycling unless it is visibly identifiable as such');
    expect(prompts.videoDescription).toContain('choose trash first');
});

test('uses the backend prompt instead of an environment override', async () => {
    const generateContent = jest.fn().mockResolvedValue({
        response: { text: () => '{"description":"A person is walking.","category":"person"}' }
    });
    const getGenerativeModel = jest.fn(() => ({ generateContent }));
    GoogleGenerativeAI.mockImplementation(() => ({
        getGenerativeModel
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
            .resolves.toEqual({ description: 'A person is walking.', category: 'person' });
        expect(getGenerativeModel).toHaveBeenCalledWith(expect.objectContaining({
            generationConfig: { responseMimeType: 'application/json' }
        }));
        expect(generateContent).toHaveBeenCalledWith([
            { fileData: { fileUri: 'test-uri', mimeType: 'video/mp4' } },
            prompts.videoDescription
        ]);
    } finally {
        if (previousPrompt === undefined) delete process.env.APP_AI_USER_PROMPT;
        else process.env.APP_AI_USER_PROMPT = previousPrompt;
    }
});

test.each(['delivery', 'vehicle', 'person', 'animal', 'trash', 'uncategorized'])(
    'accepts the %s category',
    async (category) => {
        GoogleGenerativeAI.mockImplementation(() => ({
            getGenerativeModel: () => ({
                generateContent: jest.fn().mockResolvedValue({
                    response: { text: () => JSON.stringify({ description: 'Motion detected.', category }) }
                })
            })
        }));
        GoogleAIFileManager.mockImplementation(() => ({
            uploadFile: jest.fn().mockResolvedValue({
                file: { state: 'ACTIVE', uri: 'test-uri', mimeType: 'video/mp4' }
            })
        }));
        await expect(getVideoDescriptionViaGemini('recording.mp4', 'Front Door'))
            .resolves.toEqual({ description: 'Motion detected.', category });
    }
);

test.each([
    'not json',
    '{"description":"","category":"delivery"}',
    '{"description":"A person walks.","category":"other"}',
    '{"description":"A person walks."}'
])('rejects invalid AI response: %s', async (response) => {
    GoogleGenerativeAI.mockImplementation(() => ({
        getGenerativeModel: () => ({
            generateContent: jest.fn().mockResolvedValue({ response: { text: () => response } })
        })
    }));
    GoogleAIFileManager.mockImplementation(() => ({
        uploadFile: jest.fn().mockResolvedValue({
            file: { state: 'ACTIVE', uri: 'test-uri', mimeType: 'video/mp4' }
        })
    }));

    await expect(getVideoDescriptionViaGemini('recording.mp4', 'Front Door'))
        .rejects.toThrow('All Gemini keys failed to describe the video.');
});
