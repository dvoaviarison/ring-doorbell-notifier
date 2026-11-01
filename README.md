# Ring Doorbell Notifier
Simple, LLM/AI powered ([ollama](https://ollama.com), [together-ai](https://api.together.ai) or [Gemini](https://ai.google.dev/gemini-api/docs/models/gemini)) nodejs app that will let you skip the expensive subscription and 
- Record your motion videos/snapshots directly on your **Mega drive**. Mega because it is the easiest and offers the best amount of free storage
- Send notification to **slack** with link to these videos when a motion is detected.
- Use AI to describe what your camera is seeing
- With this you can enjoy pretty much the same premium features of ring doorbells for totally FREE.
<img src="./docs/imgs/together.jpeg" alt="notif" width="400"/>

## How to run this locally
- Fill in the required variables in `.env.sample` and save a copy as `.env`. Set `MONGO_DB_CONNECTION_STRING` and a long random `SESSION_SECRET` for web login.
- Run `npm install` then `npm start`
- Open the configured `APP_SERVER_PORT` in a browser and sign in with your Ring account. If Ring requests two-factor authentication, enter the verification code on the login page. The resulting refresh token is saved to MongoDB and `.env`.
- Use HTTPS when exposing the login page outside your local machine so Ring credentials and the session cookie are protected in transit.

## How to run as a service using forever
- Install forever: `npm install forever -g`
- Run `npm run start-service`
- To stop the process: `npm run stop-service`
- To view running services: `npm run list-services`
By running as a service, the app would auto-restart in case of crash.

## How to run in docker (need docker desktop installed)
- Like the above, fill in the variables in `.env.sample` then rename it to `.env`.
- Run the following
```sh
docker build -t ring-doorbell-notifier .
docker run -d --restart always ring-doorbell-notifier 
```
- To create a linux build and push to dockerhub. You then can deploy it in a free host like [railway](https://railway.app/dashboard) or [render](https://dashboard.render.com). Replace your username and the tag (e.g. v1.2.0)
```sh
docker buildx build --platform linux/amd64 -t username/ring-doorbell-notifier:tag .
docker push username/ring-doorbell-notifier:tag
```

Pushes to `main` automatically build and publish `dvoaviarison/ring-doorbell-notifier` to Docker Hub, starting with version `v3.0.0`. Add repository Actions secrets named `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` with your Docker Hub credentials (prefer an access token). The image is tagged with the `v`-prefixed GitVersion semantic version, `latest`, and the commit SHA. After a successful image push, the workflow creates a matching GitHub Release with automatically generated release notes. GitVersion derives version increments from commit messages: `feat:` is a minor release, `fix:`, `perf:`, and `refactor:` are patch releases, and `BREAKING CHANGE:` or `!` after a Conventional Commit type is a major release. You can also use `+semver: major`, `+semver: minor`, or `+semver: patch`.

## How to get together-ai apikey
- Create an account with [together-ai](https://api.together.ai)

## How to install ollama vision models
- Install ollama: [Here](https://ollama.com/download/mac)
- Install the vision model of your choice
```sh
# Choose one of these
ollama pull llava:7b # fastest response but not always the best
ollama pull llama3.2-vision # best response but slowest
```
- Make sure you enable AI and set the model name in `.env` file

## Troubleshooting
Sometimes the notificatoins would not work. Here are some suggestions
- Re-generate a token using `npx -p ring-client-api ring-auth-cli` and replace its value is .env
- If the notification from ring is working but not for this app, go to the ring app > Control Center and remove all trusted devices
- If all notifications stopped even for the ring app, remove the doorbells from your account and add them back
