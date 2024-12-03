# Ring Doorbell Notifier
Simple nodejs app that will let you skip the expensive subscription and 
- Record your motion videos/snapshots directly on your **Mega drive**. Mega because it is the easiest and offers the best amount of free storage
- Send notification to **slack** with link to these videos when a motion is detected.
- With this you can enjoy pretty much the same premium features of ring doorbells for totally FREE.
<img src="./docs/imgs/slack-notif.jpeg" alt="notif" width="400"/>

## How to run this locally
- The hardest part is to fill in the variables in `.env.sample` then rename it to `.env`.
- Run `npm install` then `npm start`

## How to run in docker (need docker desktop installed)
- Like the above, fill in the variables in `.env.sample` then rename it to `.env`.
- Run the following
```sh
docker build -t ring-doorbell-notifier .
docker run -d --restart always ring-doorbell-notifier 
```

