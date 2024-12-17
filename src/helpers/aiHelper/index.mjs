import "dotenv/config";
import ollama from 'ollama';
import Together from "together-ai";
import * as fs from 'fs';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../logHelper/index.mjs";

const { env } = process;

const sysPrompt = `In one short sentence, tell me what is in the given camera snapshot.
No need to describe the door, poles or the walls, only the potentially moving entities, object, human or animal`

function encodeImage(imagePath) {
    const imageFile = fs.readFileSync(imagePath);
    return Buffer.from(imageFile).toString('base64');
}

export async function getAIPoweredSnapshotDescription(fileName, cameraName){
    switch (env.APP_AI_TYPE) {
        case 'together-ai':
            return await getSnapshotDescriptionViaTogetherAI(fileName, cameraName);
        case 'gemini':
            return await getSnapshotDescriptionViaGemini(fileName, cameraName);
        default:
            return await getSnapshotDescriptionViaOllama(fileName, cameraName);
    }
}

export async function getSnapshotDescriptionViaTogetherAI(fileName, cameraName) {
    const together = new Together({ apiKey: env.APP_AI_TOGETHER_API_KEY });
    const imagePath = `${env.APP_RECORDING_FOLDER}/${fileName}`;
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
export async function getSnapshotDescriptionViaOllama(fileName, cameraName) {
    const imagePath = `${env.APP_RECORDING_FOLDER}/${fileName}`;
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

export async function getSnapshotDescriptionViaGemini(fileName, cameraName) {
    const genAI = new GoogleGenerativeAI(env.APP_AI_GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: env.APP_AI_GEMINI_MODEL });
    const imagePath = `${env.APP_RECORDING_FOLDER}/${fileName}`;
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
}
