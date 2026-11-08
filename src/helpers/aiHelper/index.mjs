import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../logHelper/index.mjs";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import GeminiKeyManager from './geminiKeyManager/index.mjs';
import { prompts } from './prompts.mjs';

const { env } = process;

let activeGeminiKeyManager = new GeminiKeyManager(env.APP_AI_GEMINI_API_KEYS);

export async function getAIPoweredVideoDescription(videoFileName, cameraName) {
    return getVideoDescriptionViaGemini(videoFileName, cameraName);
}

export async function getVideoDescriptionViaGemini(videoFileName, cameraName) {
    const keyCount = activeGeminiKeyManager.getKeyCount();
    if (keyCount === 0) {
        throw new Error('No Gemini keys configured.');
    }

    for (let attempt = 0; attempt < keyCount; attempt++) {
        const apiKey = activeGeminiKeyManager.getCurrentKey();
        try {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: env.APP_AI_GEMINI_MODEL });
            const file = await uploadToGemini(videoFileName);

            const result = await model.generateContent([
                {
                    fileData: {
                        fileUri: file.uri,
                        mimeType: file.mimeType,
                    },
                },
                prompts.videoDescription.replace(/%cameraName%/g, cameraName)
            ]);

            const description = result.response.text();
            logger.info(`Gemini video description ready: ${description}`);
            return description;
        } catch (error) {
            logger.error(`Failed to get video description from gemini with current key: ${error}`);
            activeGeminiKeyManager.moveNext();
        }
    }

    throw new Error('All Gemini keys failed to describe the video.');
}

async function uploadToGemini(fileName, mimeType = "video/mp4") {
    const apiKey = activeGeminiKeyManager.getCurrentKey();
    const filePath = `${env.APP_RECORDING_FOLDER}/${fileName}`;
    const fileManager = new GoogleAIFileManager(apiKey);
    const uploadResult = await fileManager.uploadFile(filePath, {
        mimeType,
        displayName: fileName,
    });
    let file = uploadResult.file;
    logger.info(`Uploaded file ${file.displayName} as: ${file.name} to gemini`);

    logger.info("Waiting for file processing...");
    while (file.state === "PROCESSING") {
        process.stdout.write(".")
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        file = await fileManager.getFile(file.name)
    }

    if (file.state !== "ACTIVE") {
        logger.error(`File ${file.name} failed to process`);
        return;
    }
    logger.info("...all files ready");

    return file;
}