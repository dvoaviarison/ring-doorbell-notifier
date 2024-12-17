import "dotenv/config";
import ollama from 'ollama';
import Together from "together-ai";
import * as fs from 'fs';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../logHelper/index.mjs";
import { GoogleAIFileManager } from "@google/generative-ai/server";

const { env } = process;

const sysPrompt = `In one short sentence, tell me what is in the given camera snapshot.
No need to describe the door, poles or the walls, only the potentially moving entities, object, human or animal`

function encodeImage(imagePath) {
    const imageFile = fs.readFileSync(imagePath);
    return Buffer.from(imageFile).toString('base64');
}

export async function getAIPoweredSnapshotDescription(snapshotFileName, videoFileName, cameraName) {
    switch (env.APP_AI_TYPE) {
        case 'together-ai':
            return await getSnapshotDescriptionViaTogetherAI(snapshotFileName, cameraName);
        case 'gemini':
            return await getVideoDescriptionViaGemini(snapshotFileName, videoFileName, cameraName);
        default:
            return await getSnapshotDescriptionViaOllama(snapshotFileName, cameraName);
    }
}

export async function getSnapshotDescriptionViaTogetherAI(snapshotFileName, cameraName) {
    const together = new Together({ apiKey: env.APP_AI_TOGETHER_API_KEY });
    const imagePath = `${env.APP_RECORDING_FOLDER}/${snapshotFileName}`;
    logger.info('Using Together AI to get snapshot description...');
    try {
        const instruction = env.APP_AI_USER_PROMPT.replace(/%cameraName%/g, cameraName);
        const base64Image = encodeImage(imagePath);
        const stream = await together.chat.completions.create({
            messages: [
                {
                    "role": "system",
                    "content": sysPrompt
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": instruction
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": `data:image/png;base64,${base64Image}`
                            },
                        }
                    ]
                }
            ],
            model: env.APP_AI_TOGETHER_MODEL,
            max_tokens: null,
            temperature: 0.7,
            top_p: 0.7,
            top_k: 50,
            repetition_penalty: 1,
            stop: ["<|eot_id|>", "<|eom_id|>"],
            stream: true
        });

        let response = '';
        for await (const chunk of stream) {
            response += chunk.choices[0]?.delta?.content || "";
        }

        if (response) {
            logger.info(`AI Snapshot description ready: ${response}`);
        } else {
            logger.info('No description available for the image.');
        }

        return response;
    } catch (error) {
        logger.info('Error describing image:', error);
    }
}

// This assumes that you have llama3.2-vision installed locally
export async function getSnapshotDescriptionViaOllama(snapshotFileName, cameraName) {
    const imagePath = `${env.APP_RECORDING_FOLDER}/${snapshotFileName}`;
    logger.info('Using AI to get snapshot description...');
    const res = await ollama.chat({
        model: env.APP_AI_OLLAMA_MODEL,
        messages: [{
            role: 'user',
            content: `This a snapshot from my ${cameraName}. 
            In one short sentence, tell me what is in my ${cameraName}?.
            No need to describe the door, poles or the walls.`,
            images: [imagePath]
        }]
    });

    var description = res?.message?.content;
    logger.info(`AI Snapshot description ready: ${description}`);

    return description;
}

export async function getSnapshotDescriptionViaGemini(snapshotFileName, cameraName) {
    try {
        const genAI = new GoogleGenerativeAI(env.APP_AI_GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: env.APP_AI_GEMINI_MODEL });
        const imagePath = `${env.APP_RECORDING_FOLDER}/${snapshotFileName}`;
        const base64Image = encodeImage(imagePath);
        const instruction = env.APP_AI_USER_PROMPT.replace(/%cameraName%/g, cameraName);
    
        const imageResp = await fetch(`data:image/png;base64,${base64Image}`)
            .then((response) => response.arrayBuffer());
    
        const result = await model.generateContent([
            {
                inlineData: {
                    data: Buffer.from(imageResp).toString("base64"),
                    mimeType: "image/jpeg",
                },
            },
            `Your role is to tell me what you see. Only focus on the entities that are susceptible to be in motion. If none, then tell me there is nothing. Do not say snapshot. ${instruction}`
        ]);
    
        const description = result.response.text();
        return description;
    } catch (error){
        logger.error(`Failed to get snapshot description from gemini, falling back. ${error}`);
        return await getSnapshotDescriptionViaTogetherAI(snapshotFileName, cameraName);
    }
}

export async function getVideoDescriptionViaGemini(snapshotFileName, videoFileName, cameraName) {
    try {
        const genAI = new GoogleGenerativeAI(env.APP_AI_GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: env.APP_AI_GEMINI_MODEL });
        const file = await uploadToGemini(videoFileName);

        const result = await model.generateContent([
            {
                fileData: {
                    fileUri: file.uri,
                    mimeType: file.mimeType,
                },
            },
            `This is from my ${cameraName} camera. In one sentence, what did you see. Please focus only on the object, person or animal in motion. Start with "${cameraName}: ". Please make it sounds like a notification with no introduction, no 'okay'`
        ]);

        const description = result.response.text();
        logger.info(`Gemini video description ready: ${description}`);
        return description;
    } catch (error) {
        logger.error(`Failed to get video description from gemini, falling back. ${error}`);
        return await getSnapshotDescriptionViaGemini(snapshotFileName, cameraName);
    }
}

async function uploadToGemini(fileName, mimeType = "video/mp4") {
    const filePath = `${env.APP_RECORDING_FOLDER}/${fileName}`;
    const fileManager = new GoogleAIFileManager(env.APP_AI_GEMINI_API_KEY);
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