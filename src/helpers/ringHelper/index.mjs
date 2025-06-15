import { RingApi } from 'ring-client-api';
import { getRefreshToken } from "../dbHelper/index.mjs";

export async function getLoggedInRingApi(){
    const refreshToken = await getRefreshToken();
    const ringApi = new RingApi({
        refreshToken: refreshToken,
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