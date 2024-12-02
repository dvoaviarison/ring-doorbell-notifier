import "dotenv/config";
import { google } from 'googleapis';
import fs from 'fs';

const { env } = process;

// Set up OAuth2 client
const CLIENT_ID = env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = env.GOOGLE_REDIRECT_URI;
const REFRESH_TOKEN = env.GOOGLE_REFRESH_TOKEN;

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

oauth2Client.setCredentials({refresh_token: REFRESH_TOKEN});

async function checkFileExists(path, retries = 10, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        if (fs.existsSync(path)) {
            return true;
        }
        console.log(`File not found. Retrying (${i + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    console.log(`File not found after {retries} retries. Giving up`);
    return false;
}

export async function uploadFileToDrive(fileName) {
    const filePath = `${env.APP_RECORDING_FOLDER}/${fileName}`;
    const fileExists = await checkFileExists(filePath);
    if (fileExists) {
        try {
            const drive = google.drive({
                version: 'v3',
                auth: oauth2Client
            });
            const fileMetadata = {
                'name': fileName,
            };
            const media = {
                mimeType: 'video/mp4',
                body: fs.createReadStream(filePath)
            };
            const response = await drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id'
            });

            // Get the file link
            const fileId = response.data.id;
            await drive.permissions.create({ fileId: fileId, resource: { role: 'reader', type: 'anyone' } });
            const fileLink = `https://drive.google.com/file/d/${fileId}/preview`;
            console.log('File uploaded successfully! Here is the link: ', fileLink);
            return fileLink;
        } catch (error) {
            console.error('Error uploading file: ', error);
        }
    }
}

export async function uploadFileToYoutube(fileName) {
    const filePath = `${env.APP_RECORDING_FOLDER}/${fileName}`;
    const fileExists = await checkFileExists(filePath);
    if (fileExists) {
        try {
            const youtube = google.youtube({ 
                version: 'v3', 
                auth: oauth2Client 
            });
            const fileMetadata = {
                snippet: {
                  title: fileName,
                  description: 'This is an unlisted video uploaded via RingVideoHack',
                  tags: ['JavaScript', 'YouTube', 'API']
                },
                status: {
                  privacyStatus: 'unlisted'
                }
              };
              const media = {
                body: fs.createReadStream(filePath)
              };
              const response = await youtube.videos.insert({
                part: 'snippet,status',
                requestBody: fileMetadata,
                media: media
              });
              const videoLink = `https://www.youtube.com/watch?v=${response.data.id}`;
              console.log('Video uploaded successfully! Here is the link: ', videoLink);
              return videoLink;
        } catch (error) {
            console.error('Error uploading file: ', error);
        }
    }
}
