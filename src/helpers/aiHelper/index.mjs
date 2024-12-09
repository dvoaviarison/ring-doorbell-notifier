import "dotenv/config";
import ollama from 'ollama';
import Together from "together-ai";
import * as fs from 'fs';
import { logger } from "../logHelper/index.mjs";

const { env } = process;

function encodeImage(imagePath) {
    const imageFile = fs.readFileSync(imagePath);
    return Buffer.from(imageFile).toString('base64');
}

export async function getAIPoweredSnapshotDescription(fileName, cameraName){
    if (env.APP_AI_TYPE === 'together-ai'){
        return await getSnapshotDescriptionViaTogetherAI(fileName, cameraName);
    } else {
        return await getSnapshotDescriptionViaOllama(fileName, cameraName);
    }
}

export async function getSnapshotDescriptionViaTogetherAI(fileName, cameraName) {
    const together = new Together({ apiKey: env.APP_AI_TOGETHER_API_KEY });
    const imagePath = `${env.APP_RECORDING_FOLDER}/${fileName}`;
    logger.info('Using Together AI to get snapshot description...');
    try {
        const instruction = `This a snapshot from my ${cameraName}. In one short sentence, tell me what is in my ${cameraName}?`
        const base64Image = encodeImage(imagePath);
        const stream = await together.chat.completions.create({
            messages: [
                {
                    "role": "system",
                    "content": "In one short sentence, tell me what is in the given camera snapshot.\nNo need to describe the door, poles or the walls, only the potentially moving entities, object, human or animal"
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
            model: env.APP_AI_VISION_MODEL,
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
    } catch (error) {
        logger.info('Error describing image:', error);
    }
}

// This assumes that you have llama3.2-vision installed locally
export async function getSnapshotDescriptionViaOllama(fileName, cameraName) {
    const imagePath = `${env.APP_RECORDING_FOLDER}/${fileName}`;
    logger.info('Using AI to get snapshot description...');
    const res = await ollama.chat({
        model: env.APP_AI_VISION_MODEL,
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
