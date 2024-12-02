import "dotenv/config";
import {google} from 'googleapis';
import readline from 'readline';

const { env } = process;
const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI
);

// Generate an authentication URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/drive.file']
});

console.log('Authorize this app by visiting this URL: ', authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Enter the code from that page here: ', (code) => {
  oauth2Client.getToken(code, (err, token) => {
    if (err) {
      console.error('Error retrieving access token', err);
      return;
    }
    oauth2Client.setCredentials(token);
    console.log('Token retrieved and stored:', token);
    rl.close();
  });
});
