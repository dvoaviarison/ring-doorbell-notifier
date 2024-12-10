import "dotenv/config";
import { RingApi } from 'ring-client-api';

const { env } = process;

export function getLoggedInRingApi(){
    const ringApi = new RingApi({
        refreshToken: env.RING_REFRESH_TOKEN,
    });

    return ringApi;
}

export function findCamera(locations, cameraName) {
    for (const location of locations) {
        for (const camera of location.cameras) {
            if (camera.name.toLowerCase() === cameraName.toLowerCase()) {
                return camera;
            }
        }
    }
    return null;
}