# Ring Doorbell Notifier
Simple, AI powered (if [ollama](https://ollama.com) installed) nodejs app that will let you skip the expensive subscription and 
- Record your motion videos/snapshots directly on your **Mega drive**. Mega because it is the easiest and offers the best amount of free storage
- Send notification to **slack** with link to these videos when a motion is detected.
- Use AI to describe what your camera is seeing
- With this you can enjoy pretty much the same premium features of ring doorbells for totally FREE.
<img src="./docs/imgs/slack-notif.jpeg" alt="notif" width="400"/>

## How to run this locally
- The hardest part is to fill in the variables in `.env.sample` then rename it to `.env`.
- Run `npm install` then `npm start`

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

