# Ring Doorbell Notifier
Simple, Gemini AI-powered ([Gemini](https://ai.google.dev/gemini-api/docs/models/gemini)) nodejs app that will let you skip the expensive subscription and
- Record motion videos directly on your **Mega drive**. Mega because it is the easiest and offers the best amount of free storage
- Browse recorded events by day, jump to dates with the calendar picker, and play MEGA-hosted videos in the app without leaving the page. Event times are shown in the browser's local timezone. A JPEG preview is extracted from each recording, uploaded to MEGA beside its video, and shown in the event list.
- Send notification to **Slack** with the recorded video attached when motion is detected.
- Use AI to describe what your camera is seeing
- With this you can enjoy pretty much the same premium features of ring doorbells for totally FREE.
<img src="./docs/imgs/slack-notification.jpeg" alt="Slack notification with a video recording" width="400"/>

## How to run this locally
- Fill in the required variables in `.env.sample` and save a copy as `.env`. Set `MONGO_DB_CONNECTION_STRING` and a long random `SESSION_SECRET` for web login. `MONGO_DB_EVENTS_COLLECTION_NAME` selects the MongoDB collection for Mega upload events (default: `events`). Each successfully uploaded video is recorded with its UTC timestamp, the raw event description, and its Mega link; the thumbnail link is included when thumbnail generation and upload succeed. The app applies Slack-specific formatting separately when sending Slack notifications. On Render, set `SESSION_SECRET` under the service's **Environment** settings; without it the app uses a temporary random secret, so sessions are invalidated whenever the server restarts.
- Use Node.js 22 or newer for Ring push notifications. The Docker image uses Node 22 and pins the Ring push receiver to a version that correctly parses Ring's notification encryption headers.
- Install FFmpeg on the host when running outside Docker; it is used to create each event's JPEG thumbnail. Set `FFMPEG_PATH` if the executable is not named `ffmpeg` or is not on `PATH`. Thumbnail generation is best-effort, so a failed extraction or upload does not prevent saving the video event.
- Run `npm install` then `npm start`
- Open the configured `APP_SERVER_PORT` in a browser. The app automatically reuses the Ring refresh token saved in MongoDB when it remains valid, so you do not need to sign in on each visit or restart. To connect or reconnect, open the **Settings** tab and sign in with your Ring account; if Ring requests two-factor authentication, enter the verification code there. MongoDB is the source of truth for the token, including in container deployments where filesystems may be ephemeral.
- Use HTTPS when exposing the login page outside your local machine so Ring credentials and the session cookie are protected in transit.
- Interactive backend API documentation is available at `/api-docs` after signing in through the web UI. The Swagger UI uses the existing application session; operational API endpoints remain protected by the same authentication middleware.
- To enable browser push notifications, generate a VAPID key pair with `npx web-push generate-vapid-keys` and set `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, and `WEB_PUSH_VAPID_SUBJECT` in the server environment (for example, `mailto:admin@example.com`). Keep the private key secret and stable; changing it requires browsers to subscribe again. Open Settings over HTTPS and enable notifications on each browser/device. On iPhone/iPad, install the site to the Home Screen first. Push notifications are sent after a video is uploaded and its event is saved.

## How to run as a service using forever
- Install forever: `npm install forever -g`
- Run `npm run start-service`
- To stop the process: `npm run stop-service`
- To view running services: `npm run list-services`
By running as a service, the app would auto-restart in case of crash.

## How to run with Docker Compose
- Copy `.env.sample` to `.env` and fill in the required values, including `MONGO_DB_CONNECTION_STRING` and a long random `SESSION_SECRET`.
- From the project directory, build and start the app:
```sh
docker compose pull
docker compose up -d
```
- Compose pulls the latest published image from Docker Hub. The published image supports `amd64` and 64-bit Raspberry Pi (`arm64`). Watchtower checks for updates every five minutes and restarts the app when a new image is available. Open `http://<raspberry-pi-address>:<APP_SERVER_PORT>` (default port `3600`). Recordings are kept in a Docker-managed volume.
- The Compose service uses the maintained `nickfedor/watchtower` image; the original `containrrr/watchtower` image may use a Docker API client too old for current Docker Engine versions.
- Watchtower requires access to `/var/run/docker.sock` so it can update containers. This grants it broad control over the Docker host; only use this configuration on a trusted machine.
- To view logs or stop the app:
```sh
docker compose logs -f
docker compose down
```
- To create a linux build and push to dockerhub. You then can deploy it in a free host like [railway](https://railway.app/dashboard) or [render](https://dashboard.render.com). Replace your username and the tag (e.g. v1.2.0)
```sh
docker buildx build --platform linux/amd64 -t username/ring-doorbell-notifier:tag .
docker push username/ring-doorbell-notifier:tag
```

Pushes to `main` automatically build and publish `dvoaviarison/ring-doorbell-notifier` to Docker Hub, starting with version `v3.0.0`. Add repository Actions secrets named `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` with your Docker Hub credentials (prefer an access token). The image is tagged with the `v`-prefixed GitVersion semantic version, `latest`, and the commit SHA. After a successful image push, the workflow creates a matching GitHub Release with automatically generated release notes. The separate Render deployment job targets the `render-production` GitHub Environment, so it can be held for reviewer approval before deploying the exact new image tag. Create that Environment in repository settings, configure required reviewers, and add its `RENDER_DEPLOY_HOOK_URL` environment secret containing the image-backed Render service's deploy hook URL. Configure the Render service to use `docker.io/dvoaviarison/ring-doorbell-notifier` and ensure Render has credentials to pull the Docker Hub image if it is private. GitVersion derives version increments from commit messages: `feat:` is a minor release, `fix:`, `perf:`, and `refactor:` are patch releases, and `BREAKING CHANGE:` or `!` after a Conventional Commit type is a major release. You can also use `+semver: major`, `+semver: minor`, or `+semver: patch`.

## Troubleshooting
Sometimes the notificatoins would not work. Here are some suggestions
- Re-generate a token using `npx -p ring-client-api ring-auth-cli` and replace its value is .env
- If the notification from ring is working but not for this app, go to the ring app > Control Center and remove all trusted devices
- If all notifications stopped even for the ring app, remove the doorbells from your account and add them back
