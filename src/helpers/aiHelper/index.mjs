import "dotenv/config";
import ollama from 'ollama';
import { logger } from "../logHelper/index.mjs";

const { env } = process;

// This assumes that you have llama3.2-vision installed locally
export async function getSnapshotDescription(fileName, cameraName) {
    const imagePath = `${env.APP_RECORDING_FOLDER}/${fileName}`;
    logger.info('Using AI to get snapshot description...');
    const res = await ollama.chat({
        model: env.APP_AI_VISION_MODEL,
        messages: [{
            role: 'user',
            content: `This a snapshot from my ${cameraName}. What is going on in my ${cameraName}. If persons, I am interested in gender, if animal or objects, I am interested in it's nature, color, shape. One short sentence please.`,
            images: [imagePath]
        }]
    });

    var description = res?.message?.content;
    logger.info(`AI Snapshot description ready: ${description}`);

    return description;
}
