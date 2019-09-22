"use strict"

const line = require("@line/bot-sdk")
const express = require("express")
const app = express()
const fs = require("fs")
const path = require("path")
const cp = require("child_process")
const ngrok = require("ngrok")
const morgan = require("morgan")
const request = require("request-promise")
const QRCode = require("qrcode")
const LineLogin = require("../line-login")
const session = require("express-session")
const { get } = require("lodash")
const axios = require("axios")
const bodyParser = require("body-parser")
const serverless = require('serverless-http');
// const soap = require("soap");
const soap = require("strong-soap").soap
require("dotenv").config()

// create LINE SDK config from env variables
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

// base URL for webhook server
let baseURL = process.env.BASE_URL

// create LINE SDK client
const client = new line.Client(config)

// parse application/x-www-form-urlencoded
//app.use(bodyParser.urlencoded({ extended: false }))

// parse application/json
//app.use(bodyParser.json())

// create Express app
// about Express itself: https://expressjs.com/
app.use("/liff", express.static("public"))

const session_options = {
  secret: process.env.LINE_LOGIN_CHANNEL_SECRET,
  resave: false,
  saveUninitialized: false
}
app.use(session(session_options))

const lineAuth = new LineLogin({
  channel_id: process.env.LINE_LOGIN_CHANNEL_ID,
  channel_secret: process.env.LINE_LOGIN_CHANNEL_SECRET,
  callback_url: process.env.LINE_LOGIN_CALLBACK_URL,
  scope: "openid profile",
  prompt: "consent",
  bot_prompt: "normal"
})

app.use(morgan("dev"))

// serve static and downloaded files
app.use("/static", express.static("static"))
app.use("/downloaded", express.static("downloaded"))

// Specify the path you want to start authorization.
app.use("/auth-line", lineAuth.auth())

// Specify the path you want to wait for the callback from LINE authorization endpoint.
app.use(
  "/line-auth-callback",
  lineAuth.callback(
    (req, res, next, token_response) => {
      // Success callback
      res.json(token_response)
    },
    (req, res, next, error) => {
      // Failure callback
      res.status(400).json(error)
    }
  )
)

app.post("/form", function(req, res) {
  console.log(req.body)
  res.send("ok")
})

app.get("/callback", (req, res) =>
  res.end(`I'm listening. Please access with POST.`)
)

// webhook callback
app.post("/callback", line.middleware(config), (req, res) => {
  if (req.body.destination) {
    console.log("Destination User ID: " + req.body.destination)
  }
  const event = get(req, ["body", "events", "0"])
  const userId = get(event, ["source", "userId"])
  console.log("event: ", event)
  // console.log("userId:", userId);
  console.log("Request headers: " + JSON.stringify(req.headers))
  console.log("Request body: " + JSON.stringify(req.body))

  // req.body.events should be an array of events
  if (!Array.isArray(req.body.events)) {
    return res.status(500).end()
  }

  Promise.all(req.body.events.map(event => handleEvent(event, req, res)))
    .then(() => res.end())
    .catch(err => {
      console.error(err)
      res.status(500).end()
    })
})

// simple reply function
const replyText = (token, texts) => {
  texts = Array.isArray(texts) ? texts : [texts]
  return client.replyMessage(token, texts.map(text => ({ type: "text", text })))
}

// callback function to handle a single event
function handleEvent(event, req, res) {
  if (event.replyToken && event.replyToken.match(/^(.)\1*$/)) {
    return console.log("Test hook recieved: " + JSON.stringify(event.message))
  }
  const userId = get(event, ["source", "userId"])

  switch (event.type) {
    case "message":
      const message = event.message
      switch (message.type) {
        case "text":
          return handleText(message, event.replyToken, event.source, req)
        case "image":
          return handleImage(message, event.replyToken)
        case "video":
          return handleVideo(message, event.replyToken)
        case "audio":
          return handleAudio(message, event.replyToken)
        case "location":
          return handleLocation(message, event.replyToken)
        case "sticker":
          return handleSticker(message, event.replyToken)
        default:
          throw new Error(`Unknown message: ${JSON.stringify(message)}`)
      }

    case "follow":
      return replyText(event.replyToken, "Got followed event")

    case "unfollow":
      return console.log(`Unfollowed this bot: ${JSON.stringify(event)}`)

    case "join":
      return replyText(event.replyToken, `Joined ${event.source.type}`)

    case "leave":
      return console.log(`Left: ${JSON.stringify(event)}`)

    case "postback":
      let data = event.postback.data
      if (data === "DATE" || data === "TIME" || data === "DATETIME") {
        data += `(${JSON.stringify(event.postback.params)})`
      }
      return replyText(event.replyToken, `Got postback: ${data}`)

    case "beacon":
      return replyText(event.replyToken, `Got beacon: ${event.beacon.hwid}`)

    default:
      throw new Error(`Unknown event: ${JSON.stringify(event)}`)
  }
}

function handleText(message, replyToken, source, req) {
  const buttonsImageURL = `https://659d22d5.ngrok.io/static/buttons/1040.jpg`

  if (keywordCategory.includes(message.text.toLowerCase())) {
    const items = productItems.filter(
      item =>
        item.product_category_name.toLowerCase() === message.text.toLowerCase()
    )
    if (items.length) {
      return client.replyMessage(replyToken, mapItemFlexProduct(items))
    }
    return replyText(replyToken, message.text)
  } else {
    switch (message.text) {
      case "profile":
        if (source.userId) {
          return client
            .getProfile(source.userId)
            .then(profile =>
              replyText(replyToken, [
                `Display name: ${profile.displayName}`,
                `Status message: ${profile.statusMessage}`
              ])
            )
        } else {
          return replyText(
            replyToken,
            "Bot can't use profile API without user ID"
          )
        }
      case "ขอใบเสนอราคา":
        return client.replyMessage(replyToken, [
          {
            type: "text",
            text: "https://santipab.info/quotation?userId=" + source.userId
          },
          {
            type: "template",
            altText: "Buttons alt text",
            template: {
              type: "buttons",
              thumbnailImageUrl:
                "https://1.bp.blogspot.com/-LnRrin8y-o0/XCt2EQfb4qI/AAAAAAA_Ryg/nVyZlF0Jq9AY5gU8dSMQ8D1qKsX36hCOQCLcBGAs/s1600/AW2859968_08.gif",
              title: "บริการจองคิวออนไลน์",
              text: "โรงพยาบาลยินดีให้บริการ",
              actions: [
                {
                  label: "คลิกที่นี่เพื่อจองคิว",
                  type: "uri",
                  uri: "line://app/1583147071-w3v6DmZZ"
                },
                {
                  label: "Say hello1",
                  type: "postback",
                  data: "hello こんにちは"
                },
                {
                  label: "言 hello2",
                  type: "postback",
                  data: "hello こんにちは",
                  text: "hello こんにちは"
                },
                { label: "Say message", type: "message", text: "Rice=米" }
              ]
            }
          }
        ])
      case "confirm":
        return client.replyMessage(replyToken, {
          type: "template",
          altText: "Confirm alt text",
          template: {
            type: "confirm",
            text: "Do it?",
            actions: [
              { label: "Yes", type: "message", text: "Yes!" },
              { label: "No", type: "message", text: "No!" }
            ]
          }
        })
      case "สินค้า": // carousel
        const columns = [
          {
            imageUrl:
              "https://scdn.line-apps.com/n/channel_devcenter/img/fx/01_5_carousel.png",
            action: {
              type: "postback",
              label: "Buy",
              data: "action=buy&itemid=111"
            }
          },
          {
            imageUrl:
              "https://scdn.line-apps.com/n/channel_devcenter/img/fx/01_5_carousel.png",
            action: {
              type: "message",
              label: "Yes",
              text: "yes"
            }
          },
          {
            imageUrl:
              "https://scdn.line-apps.com/n/channel_devcenter/img/fx/01_5_carousel.png",
            action: {
              type: "uri",
              label: "View detail",
              uri: "http://example.com/page/222"
            }
          },
          {
            imageUrl:
              "https://scdn.line-apps.com/n/channel_devcenter/img/fx/01_5_carousel.png",
            action: {
              type: "postback",
              label: "Buy",
              data: "action=buy&itemid=111"
            }
          },
          {
            imageUrl:
              "https://scdn.line-apps.com/n/channel_devcenter/img/fx/01_5_carousel.png",
            action: {
              type: "message",
              label: "Yes",
              text: "yes"
            }
          },
          {
            imageUrl:
              "https://scdn.line-apps.com/n/channel_devcenter/img/fx/01_5_carousel.png",
            action: {
              type: "uri",
              label: "View detail",
              uri: "http://example.com/page/222"
            }
          },
          {
            imageUrl:
              "https://scdn.line-apps.com/n/channel_devcenter/img/fx/01_5_carousel.png",
            action: {
              type: "postback",
              label: "Buy",
              data: "action=buy&itemid=111"
            }
          },
          {
            imageUrl:
              "https://scdn.line-apps.com/n/channel_devcenter/img/fx/01_5_carousel.png",
            action: {
              type: "message",
              label: "Yes",
              text: "yes"
            }
          },
          {
            imageUrl:
              "https://scdn.line-apps.com/n/channel_devcenter/img/fx/01_5_carousel.png",
            action: {
              type: "uri",
              label: "View detail",
              uri: "http://example.com/page/222"
            }
          },
          {
            imageUrl:
              "https://scdn.line-apps.com/n/channel_devcenter/img/fx/01_5_carousel.png",
            action: {
              type: "uri",
              label: "View detail",
              uri: "http://example.com/page/222"
            }
          }
        ]
        // const columns2 = [
        //   {
        //     thumbnailImageUrl:
        //       "https://santipab.info/uploads/1/qxN00YUTkn9kBRs055FZ3gEH8FsFKG2s.jpg",
        //     title: "การ์ด,นามบัตร",
        //     text: "การ์ด/นามบัตร/ป้าย tag สินค้า/ที่คั่นหนังสือ",
        //     actions: [
        //       {
        //         label: "ขอใบเสนอราคา",
        //         type: "uri",
        //         uri: "https://santipab.info/app/product/category?id=1"
        //       }
        //       /* {
        //         label: "Say hello1",
        //         type: "postback",
        //         data: "hello こんにちは"
        //       } */
        //     ]
        //   },
        //   {
        //     thumbnailImageUrl:
        //       "https://santipab.info/uploads/1/aOauAuWiLSjI_anfryNGFWJqyZGkLY9l.png",
        //     title: "สติกเกอร์,ฉลาก",
        //     text: "รายละเอียด...",
        //     actions: [
        //       {
        //         label: "ขอใบเสนอราคา",
        //         type: "uri",
        //         uri: "https://santipab.info/app/product/category?id=5"
        //       }
        //       /* {
        //         label: "言 hello2",
        //         type: "postback",
        //         data: "hello こんにちは",
        //         text: "hello こんにちは"
        //       },
        //       { label: "Say message", type: "message", text: "Rice=米" } */
        //     ]
        //   },
        //   {
        //     thumbnailImageUrl:
        //       "https://santipab.info/uploads/1/upMaOc8-3wGjk12VDnt2CLEoa1z_pqJ-.jpg",
        //     title: "ถุงกระดาษ",
        //     text: "รายละเอียด...",
        //     actions: [
        //       {
        //         label: "ขอใบเสนอราคา",
        //         type: "uri",
        //         uri: "https://santipab.info/app/product/category?id=6"
        //       }
        //       /* {
        //         label: "Say hello1",
        //         type: "postback",
        //         data: "hello こんにちは"
        //       } */
        //     ]
        //   },
        //   {
        //     thumbnailImageUrl:
        //       "https://santipab.info/uploads/1/qxN00YUTkn9kBRs055FZ3gEH8FsFKG2s.jpg",
        //     title: "การ์ด,นามบัตร",
        //     text: "การ์ด/นามบัตร/ป้าย tag สินค้า/ที่คั่นหนังสือ",
        //     actions: [
        //       {
        //         label: "ขอใบเสนอราคา",
        //         type: "uri",
        //         uri: "https://santipab.info/app/product/category?id=1"
        //       }
        //       /* {
        //         label: "Say hello1",
        //         type: "postback",
        //         data: "hello こんにちは"
        //       } */
        //     ]
        //   },
        //   {
        //     thumbnailImageUrl:
        //       "https://santipab.info/uploads/1/aOauAuWiLSjI_anfryNGFWJqyZGkLY9l.png",
        //     title: "สติกเกอร์,ฉลาก",
        //     text: "รายละเอียด...",
        //     actions: [
        //       {
        //         label: "ขอใบเสนอราคา",
        //         type: "uri",
        //         uri: "https://santipab.info/app/product/category?id=5"
        //       }
        //       /* {
        //         label: "言 hello2",
        //         type: "postback",
        //         data: "hello こんにちは",
        //         text: "hello こんにちは"
        //       },
        //       { label: "Say message", type: "message", text: "Rice=米" } */
        //     ]
        //   },
        //   {
        //     thumbnailImageUrl:
        //       "https://santipab.info/uploads/1/upMaOc8-3wGjk12VDnt2CLEoa1z_pqJ-.jpg",
        //     title: "ถุงกระดาษ",
        //     text: "รายละเอียด...",
        //     actions: [
        //       {
        //         label: "ขอใบเสนอราคา",
        //         type: "uri",
        //         uri: "https://santipab.info/app/product/category?id=6"
        //       }
        //       /* {
        //         label: "Say hello1",
        //         type: "postback",
        //         data: "hello こんにちは"
        //       } */
        //     ]
        //   },
        //   {
        //     thumbnailImageUrl:
        //       "https://santipab.info/uploads/1/qxN00YUTkn9kBRs055FZ3gEH8FsFKG2s.jpg",
        //     title: "การ์ด,นามบัตร",
        //     text: "การ์ด/นามบัตร/ป้าย tag สินค้า/ที่คั่นหนังสือ",
        //     actions: [
        //       {
        //         label: "ขอใบเสนอราคา",
        //         type: "uri",
        //         uri: "https://santipab.info/app/product/category?id=1"
        //       }
        //       /* {
        //         label: "Say hello1",
        //         type: "postback",
        //         data: "hello こんにちは"
        //       } */
        //     ]
        //   },
        //   {
        //     thumbnailImageUrl:
        //       "https://santipab.info/uploads/1/aOauAuWiLSjI_anfryNGFWJqyZGkLY9l.png",
        //     title: "สติกเกอร์,ฉลาก",
        //     text: "รายละเอียด...",
        //     actions: [
        //       {
        //         label: "ขอใบเสนอราคา",
        //         type: "uri",
        //         uri: "https://santipab.info/app/product/category?id=5"
        //       }
        //       /* {
        //         label: "言 hello2",
        //         type: "postback",
        //         data: "hello こんにちは",
        //         text: "hello こんにちは"
        //       },
        //       { label: "Say message", type: "message", text: "Rice=米" } */
        //     ]
        //   },
        //   {
        //     thumbnailImageUrl:
        //       "https://santipab.info/uploads/1/upMaOc8-3wGjk12VDnt2CLEoa1z_pqJ-.jpg",
        //     title: "ถุงกระดาษ",
        //     text: "รายละเอียด...",
        //     actions: [
        //       {
        //         label: "ขอใบเสนอราคา",
        //         type: "uri",
        //         uri: "https://santipab.info/app/product/category?id=6"
        //       }
        //       /* {
        //         label: "Say hello1",
        //         type: "postback",
        //         data: "hello こんにちは"
        //       } */
        //     ]
        //   },
        //   {
        //     thumbnailImageUrl:
        //       "https://santipab.info/uploads/1/upMaOc8-3wGjk12VDnt2CLEoa1z_pqJ-.jpg",
        //     title: "ถุงกระดาษ",
        //     text: "รายละเอียด...",
        //     actions: [
        //       {
        //         label: "ขอใบเสนอราคา",
        //         type: "uri",
        //         uri: "https://santipab.info/app/product/category?id=6"
        //       }
        //       /* {
        //         label: "Say hello1",
        //         type: "postback",
        //         data: "hello こんにちは"
        //       } */
        //     ]
        //   }
        // ]
        handleProduct(replyToken)
        return

      case "image carousel":
        return client.replyMessage(replyToken, {
          type: "template",
          altText: "Image carousel alt text",
          template: {
            type: "image_carousel",
            columns: [
              {
                imageUrl: buttonsImageURL,
                action: {
                  label: "Go to LINE",
                  type: "uri",
                  uri: "https://line.me"
                }
              },
              {
                imageUrl: buttonsImageURL,
                action: {
                  label: "Say hello1",
                  type: "postback",
                  data: "hello こんにちは"
                }
              },
              {
                imageUrl: buttonsImageURL,
                action: {
                  label: "Say message",
                  type: "message",
                  text: "Rice=米"
                }
              },
              {
                imageUrl: buttonsImageURL,
                action: {
                  label: "datetime",
                  type: "datetimepicker",
                  data: "DATETIME",
                  mode: "datetime"
                }
              }
            ]
          }
        })
      case "datetime":
        return client.replyMessage(replyToken, {
          type: "template",
          altText: "Datetime pickers alt text",
          template: {
            type: "buttons",
            text: "Select date / time !",
            actions: [
              {
                type: "datetimepicker",
                label: "date",
                data: "DATE",
                mode: "date"
              },
              {
                type: "datetimepicker",
                label: "time",
                data: "TIME",
                mode: "time"
              },
              {
                type: "datetimepicker",
                label: "datetime",
                data: "DATETIME",
                mode: "datetime"
              }
            ]
          }
        })
      case "imagemap":
        return client.replyMessage(replyToken, {
          type: "imagemap",
          baseUrl: `${baseURL}/static/rich`,
          altText: "Imagemap alt text",
          baseSize: { width: 1040, height: 1040 },
          actions: [
            {
              area: { x: 0, y: 0, width: 520, height: 520 },
              type: "uri",
              linkUri: "https://store.line.me/family/manga/en"
            },
            {
              area: { x: 520, y: 0, width: 520, height: 520 },
              type: "uri",
              linkUri: "https://store.line.me/family/music/en"
            },
            {
              area: { x: 0, y: 520, width: 520, height: 520 },
              type: "uri",
              linkUri: "https://store.line.me/family/play/en"
            },
            {
              area: { x: 520, y: 520, width: 520, height: 520 },
              type: "message",
              text: "URANAI!"
            }
          ],
          video: {
            originalContentUrl: `${baseURL}/static/imagemap/video.mp4`,
            previewImageUrl: `${baseURL}/static/imagemap/preview.jpg`,
            area: {
              x: 280,
              y: 385,
              width: 480,
              height: 270
            },
            externalLink: {
              linkUri: "https://line.me",
              label: "LINE"
            }
          }
        })
      case "bye":
        switch (source.type) {
          case "user":
            return replyText(replyToken, "Bot can't leave from 1:1 chat")
          case "group":
            return replyText(replyToken, "Leaving group").then(() =>
              client.leaveGroup(source.groupId)
            )
          case "room":
            return replyText(replyToken, "Leaving room").then(() =>
              client.leaveRoom(source.roomId)
            )
        }
      case "tag":
        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "ใบเสนอราคา",
          contents: {
            type: "bubble",
            styles: {
              footer: {
                separator: true
              }
            },
            body: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "text",
                  text: "รายละเอียดสินค้า",
                  weight: "bold",
                  color: "#1DB446",
                  size: "sm",
                  align: "center"
                },
                {
                  type: "text",
                  text: "นามบัตร/บัตรสะสมแต้ม",
                  weight: "bold",
                  size: "md",
                  margin: "md"
                },
                {
                  type: "text",
                  text: "ID #743289384279",
                  size: "xs",
                  color: "#aaaaaa",
                  wrap: true
                },
                {
                  type: "separator",
                  margin: "xxl"
                },
                {
                  type: "box",
                  layout: "vertical",
                  margin: "xxl",
                  spacing: "sm",
                  contents: [
                    {
                      type: "box",
                      layout: "horizontal",
                      contents: [
                        {
                          type: "text",
                          text: "ขนาด",
                          size: "sm",
                          color: "#555555",
                          flex: 0
                        },
                        {
                          type: "text",
                          text: "5*8 นิ้ว",
                          size: "sm",
                          color: "#111111",
                          align: "end"
                        }
                      ]
                    },
                    {
                      type: "box",
                      layout: "horizontal",
                      contents: [
                        {
                          type: "text",
                          text: "กระดาษ",
                          size: "sm",
                          color: "#555555",
                          flex: 0
                        },
                        {
                          type: "text",
                          text: "อาร์ตการ์ดสองหน้า 300 แกรม",
                          size: "sm",
                          color: "#111111",
                          align: "end"
                        }
                      ]
                    },
                    {
                      type: "box",
                      layout: "horizontal",
                      contents: [
                        {
                          type: "text",
                          text: "พิมพ์",
                          size: "sm",
                          color: "#555555",
                          flex: 0
                        },
                        {
                          type: "text",
                          text: "พิมพ์สองหน้า พิมพ์ 2 สี",
                          size: "sm",
                          color: "#111111",
                          align: "end"
                        }
                      ]
                    },
                    {
                      type: "box",
                      layout: "horizontal",
                      contents: [
                        {
                          type: "text",
                          text: "เคลือบ",
                          size: "sm",
                          color: "#555555",
                          flex: 0
                        },
                        {
                          type: "text",
                          text: "เคลือบ pvc ด้าน สองด้าน",
                          size: "sm",
                          color: "#111111",
                          align: "end"
                        }
                      ]
                    },
                    {
                      type: "box",
                      layout: "horizontal",
                      contents: [
                        {
                          type: "text",
                          text: "ไดคัท",
                          size: "sm",
                          color: "#555555",
                          flex: 0
                        },
                        {
                          type: "text",
                          text: "ไดคัทตามรูปแบบ",
                          size: "sm",
                          color: "#111111",
                          align: "end"
                        }
                      ]
                    },
                    {
                      type: "box",
                      layout: "horizontal",
                      contents: [
                        {
                          type: "text",
                          text: "ฟอยล์",
                          size: "sm",
                          color: "#555555",
                          flex: 0
                        },
                        {
                          type: "text",
                          text: "ไม่ปั๊มฟอยล์",
                          size: "sm",
                          color: "#111111",
                          align: "end"
                        }
                      ]
                    },
                    {
                      type: "box",
                      layout: "horizontal",
                      contents: [
                        {
                          type: "text",
                          text: "ปั๊มนูน",
                          size: "sm",
                          color: "#555555",
                          flex: 0
                        },
                        {
                          type: "text",
                          text: "ไม่ปั๊มนูน",
                          size: "sm",
                          color: "#111111",
                          align: "end"
                        }
                      ]
                    }
                  ]
                },
                {
                  type: "separator",
                  margin: "xxl"
                },
                {
                  type: "box",
                  layout: "horizontal",
                  margin: "md",
                  contents: [
                    {
                      type: "text",
                      text: "จำนวน",
                      size: "md",
                      color: "#ea7066",
                      flex: 0
                    },
                    {
                      type: "text",
                      text: "2000 ชิ้น",
                      color: "#ea7066",
                      size: "md",
                      align: "end"
                    }
                  ]
                },
                {
                  type: "box",
                  layout: "horizontal",
                  margin: "md",
                  contents: [
                    {
                      type: "text",
                      text: "ราคา",
                      size: "md",
                      color: "#ea7066",
                      flex: 0
                    },
                    {
                      type: "text",
                      text: "15,000฿",
                      color: "#ea7066",
                      size: "md",
                      align: "end"
                    }
                  ]
                }
                /* {
                type: "box",
                layout: "horizontal",
                margin: "md",
                contents: [
                  {
                    type: "text",
                    text: "ID",
                    size: "xs",
                    color: "#aaaaaa",
                    flex: 0
                  },
                  {
                    type: "text",
                    text: "#743289384279",
                    color: "#aaaaaa",
                    size: "xs",
                    align: "end"
                  }
                ]
              } */
              ]
            },
            footer: {
              type: "box",
              layout: "vertical",
              spacing: "sm",
              contents: [
                {
                  type: "button",
                  action: {
                    type: "uri",
                    label: "ดาวน์โหลดใบเสนอราคา",
                    uri:
                      "https://santipab.info/app/product/quo?q=QO-2019091700002"
                  }
                }
              ]
            }
          }
        })
      // return client.replyMessage(replyToken, {
      //   type: "flex",
      //   altText: "ตัวอย่างผลิตภัณฑ์",
      //   contents: {
      //     type: "carousel",
      //     contents: [
      //       {
      //         type: "bubble",
      //         direction: "ltr",
      //         hero: {
      //           type: "image",
      //           url:
      //             "https://santipab.info/uploads/1/qxN00YUTkn9kBRs055FZ3gEH8FsFKG2s.jpg",
      //           size: "full",
      //           aspectRatio: "20:13",
      //           aspectMode: "cover"
      //         },
      //         body: {
      //           type: "box",
      //           layout: "vertical",
      //           spacing: "sm",
      //           contents: [
      //             {
      //               type: "text",
      //               text: "การ์ด,นามบัตร,ป้าย tag สินค้า,ที่คั่นหนังสือ",
      //               size: "md",
      //               weight: "bold",
      //               wrap: true
      //             }
      //           ]
      //         },
      //         footer: {
      //           type: "box",
      //           layout: "vertical",
      //           spacing: "sm",
      //           contents: [
      //             {
      //               type: "button",
      //               action: {
      //                 type: "uri",
      //                 label: "ขอใบเสนอราคา",
      //                 uri: "https://santipab.info/app/product/category?id=1"
      //               },
      //               color: "#EA7066",
      //               style: "primary"
      //             },
      //             {
      //               type: "button",
      //               action: {
      //                 type: "uri",
      //                 label: "ตัวอย่างสินค้า",
      //                 uri: "https://santipab.info/product/catalog?p=1"
      //               },
      //               height: "sm"
      //             }
      //           ]
      //         }
      //       },
      //       {
      //         type: "bubble",
      //         direction: "ltr",
      //         hero: {
      //           type: "image",
      //           url:
      //             "https://santipab.info/uploads/1/aOauAuWiLSjI_anfryNGFWJqyZGkLY9l.png",
      //           size: "full",
      //           aspectRatio: "20:13",
      //           aspectMode: "cover"
      //         },
      //         body: {
      //           type: "box",
      //           layout: "vertical",
      //           spacing: "sm",
      //           contents: [
      //             {
      //               type: "text",
      //               text: "สติกเกอร์/ฉลาก",
      //               size: "md",
      //               weight: "bold",
      //               wrap: true
      //             }
      //           ]
      //         },
      //         footer: {
      //           type: "box",
      //           layout: "vertical",
      //           spacing: "sm",
      //           contents: [
      //             {
      //               type: "button",
      //               action: {
      //                 type: "uri",
      //                 label: "ขอใบเสนอราคา",
      //                 uri: "https://santipab.info/app/product/category?id=5"
      //               },
      //               color: "#EA7066",
      //               style: "primary"
      //             },
      //             {
      //               type: "button",
      //               action: {
      //                 type: "uri",
      //                 label: "ตัวอย่างสินค้า",
      //                 uri: "https://santipab.info/product/catalog?p=5"
      //               },
      //               height: "sm"
      //             }
      //           ]
      //         }
      //       },
      //       {
      //         type: "bubble",
      //         direction: "ltr",
      //         hero: {
      //           type: "image",
      //           url:
      //             "https://santipab.info/uploads/1/RF5WVReKEnuDTqpVdvxZeZ4UdzzCDiFY.jpg",
      //           size: "full",
      //           aspectRatio: "20:13",
      //           aspectMode: "cover"
      //         },
      //         body: {
      //           type: "box",
      //           layout: "vertical",
      //           spacing: "sm",
      //           contents: [
      //             {
      //               type: "text",
      //               text: "หนังสือ,นิตยสาร",
      //               size: "md",
      //               weight: "bold",
      //               wrap: true
      //             }
      //           ]
      //         },
      //         footer: {
      //           type: "box",
      //           layout: "vertical",
      //           spacing: "sm",
      //           contents: [
      //             {
      //               type: "button",
      //               action: {
      //                 type: "uri",
      //                 label: "ขอใบเสนอราคา",
      //                 uri: "https://santipab.info/app/product/category?id=4"
      //               },
      //               color: "#EA7066",
      //               style: "primary"
      //             },
      //             {
      //               type: "button",
      //               action: {
      //                 type: "uri",
      //                 label: "ตัวอย่างสินค้า",
      //                 uri: "https://santipab.info/product/catalog?p=4"
      //               },
      //               height: "sm"
      //             }
      //           ]
      //         }
      //       },
      //       {
      //         type: "bubble",
      //         hero: {
      //           type: "image",
      //           url:
      //             "https://santipab.info/uploads/1/3p6kmOCcMG_cgOd_MKTk-6dYxprs2Prl.png",
      //           size: "full",
      //           aspectRatio: "20:13",
      //           aspectMode: "cover"
      //         },
      //         body: {
      //           type: "box",
      //           layout: "vertical",
      //           spacing: "sm",
      //           contents: [
      //             {
      //               type: "text",
      //               text: "ใบปลิว, แผ่นพับ",
      //               size: "md",
      //               weight: "bold",
      //               wrap: true
      //             }
      //           ]
      //         },
      //         footer: {
      //           type: "box",
      //           layout: "vertical",
      //           spacing: "sm",
      //           contents: [
      //             {
      //               type: "button",
      //               action: {
      //                 type: "uri",
      //                 label: "ขอใบเสนอราคา",
      //                 uri: "https://santipab.info/app/product/category?id=2"
      //               },
      //               flex: 2,
      //               color: "#EA7066",
      //               style: "primary"
      //             },
      //             {
      //               type: "button",
      //               action: {
      //                 type: "uri",
      //                 label: "ตัวอย่างสินค้า",
      //                 uri: "https://santipab.info/product/catalog?p=2"
      //               },
      //               height: "sm"
      //             }
      //           ]
      //         }
      //       },
      //       {
      //         type: "bubble",
      //         body: {
      //           type: "box",
      //           layout: "vertical",
      //           spacing: "sm",
      //           contents: [
      //             {
      //               type: "button",
      //               action: {
      //                 type: "uri",
      //                 label: "ดูผลิตภัณฑ์อื่นๆ",
      //                 uri: "https://santipab.info/สินค้า"
      //               },
      //               flex: 1,
      //               gravity: "center"
      //             }
      //           ]
      //         }
      //       }
      //     ]
      //   }
      // });
      case "ems":
        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "ติดตามพัสดุ",
          contents: {
            type: "bubble",
            size: "mega",
            header: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "box",
                  layout: "vertical",
                  contents: [
                    {
                      type: "text",
                      text: "EMS TRACKING",
                      color: "#ffffff66",
                      size: "sm"
                    },
                    {
                      type: "text",
                      text: "EP881542195TH",
                      color: "#ffffff",
                      size: "xl",
                      flex: 4,
                      weight: "bold"
                    }
                  ]
                }
              ],
              paddingAll: "20px",
              backgroundColor: "#0367D3",
              spacing: "md",
              height: "100px",
              paddingTop: "22px"
            },
            body: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    {
                      type: "text",
                      text: "รับเข้าระบบ",
                      size: "xs",
                      gravity: "center",
                      color: "#8c8c8c",
                      flex: 4
                    },
                    {
                      type: "text",
                      text: "ระหว่างขนส่ง/สถานะ",
                      size: "xs",
                      gravity: "center",
                      color: "#8c8c8c",
                      flex: 4
                    }
                  ]
                },
                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    {
                      type: "text",
                      text: "11:09",
                      size: "sm",
                      gravity: "center",
                      flex: 2
                    },
                    {
                      type: "box",
                      layout: "vertical",
                      contents: [
                        {
                          type: "filler"
                        },
                        {
                          type: "box",
                          layout: "vertical",
                          contents: [
                            {
                              type: "filler"
                            }
                          ],
                          cornerRadius: "30px",
                          height: "12px",
                          width: "12px",
                          borderColor: "#EF454D",
                          borderWidth: "2px"
                        },
                        {
                          type: "filler"
                        }
                      ],
                      flex: 0
                    },
                    {
                      type: "text",
                      text: "ดอนเมือง",
                      gravity: "center",
                      flex: 4,
                      size: "sm"
                    }
                  ],
                  spacing: "lg",
                  cornerRadius: "30px",
                  margin: "xl"
                },
                {
                  type: "text",
                  text: "26/04/2562",
                  color: "#000000",
                  size: "xxs"
                },
                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    {
                      type: "box",
                      layout: "baseline",
                      contents: [
                        {
                          type: "filler"
                        }
                      ],
                      flex: 2
                    },
                    {
                      type: "box",
                      layout: "vertical",
                      contents: [
                        {
                          type: "box",
                          layout: "horizontal",
                          contents: [
                            {
                              type: "filler"
                            },
                            {
                              type: "box",
                              layout: "vertical",
                              contents: [
                                {
                                  type: "filler"
                                }
                              ],
                              width: "2px",
                              backgroundColor: "#B7B7B7"
                            },
                            {
                              type: "filler"
                            }
                          ],
                          flex: 1
                        }
                      ],
                      width: "12px"
                    },
                    {
                      type: "text",
                      text: "รับฝาก",
                      gravity: "center",
                      flex: 4,
                      size: "xs",
                      color: "#8c8c8c"
                    }
                  ],
                  spacing: "lg",
                  height: "64px"
                },
                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    {
                      type: "box",
                      layout: "horizontal",
                      contents: [
                        {
                          type: "text",
                          text: "17:09",
                          gravity: "center",
                          size: "sm"
                        }
                      ],
                      flex: 2
                    },
                    {
                      type: "box",
                      layout: "vertical",
                      contents: [
                        {
                          type: "filler"
                        },
                        {
                          type: "box",
                          layout: "vertical",
                          contents: [
                            {
                              type: "filler"
                            }
                          ],
                          cornerRadius: "30px",
                          width: "12px",
                          height: "12px",
                          borderWidth: "2px",
                          borderColor: "#6486E3"
                        },
                        {
                          type: "filler"
                        }
                      ],
                      flex: 0
                    },
                    {
                      type: "text",
                      text: "ดอนเมือง",
                      gravity: "center",
                      flex: 4,
                      size: "sm"
                    }
                  ],
                  spacing: "lg",
                  cornerRadius: "30px"
                },
                {
                  type: "text",
                  text: "26/04/2562",
                  color: "#000000",
                  size: "xxs"
                },
                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    {
                      type: "box",
                      layout: "baseline",
                      contents: [
                        {
                          type: "filler"
                        }
                      ],
                      flex: 2
                    },
                    {
                      type: "box",
                      layout: "vertical",
                      contents: [
                        {
                          type: "box",
                          layout: "horizontal",
                          contents: [
                            {
                              type: "filler"
                            },
                            {
                              type: "box",
                              layout: "vertical",
                              contents: [
                                {
                                  type: "filler"
                                }
                              ],
                              width: "2px",
                              backgroundColor: "#6486E3"
                            },
                            {
                              type: "filler"
                            }
                          ],
                          flex: 1
                        }
                      ],
                      width: "12px"
                    },
                    {
                      type: "text",
                      text: "อยู่ระหว่างการขนส่ง",
                      gravity: "center",
                      flex: 4,
                      size: "xs",
                      color: "#8c8c8c"
                    }
                  ],
                  spacing: "lg",
                  height: "64px"
                },
                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    {
                      type: "text",
                      text: "08:55",
                      gravity: "center",
                      size: "sm",
                      flex: 2
                    },
                    {
                      type: "box",
                      layout: "vertical",
                      contents: [
                        {
                          type: "filler"
                        },
                        {
                          type: "box",
                          layout: "vertical",
                          contents: [
                            {
                              type: "filler"
                            }
                          ],
                          cornerRadius: "30px",
                          width: "12px",
                          height: "12px",
                          borderColor: "#6486E3",
                          borderWidth: "2px"
                        },
                        {
                          type: "filler"
                        }
                      ],
                      flex: 0
                    },
                    {
                      type: "text",
                      text: "หลักสี่",
                      gravity: "center",
                      flex: 4,
                      size: "sm"
                    }
                  ],
                  spacing: "lg",
                  cornerRadius: "30px"
                },
                {
                  type: "text",
                  text: "27/04/2562",
                  color: "#000000",
                  size: "xxs"
                },
                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    {
                      type: "box",
                      layout: "baseline",
                      contents: [
                        {
                          type: "filler"
                        }
                      ],
                      flex: 2
                    },
                    {
                      type: "box",
                      layout: "vertical",
                      contents: [
                        {
                          type: "box",
                          layout: "horizontal",
                          contents: [
                            {
                              type: "filler"
                            },
                            {
                              type: "box",
                              layout: "vertical",
                              contents: [
                                {
                                  type: "filler"
                                }
                              ],
                              width: "2px",
                              backgroundColor: "#6486E3"
                            },
                            {
                              type: "filler"
                            }
                          ],
                          flex: 1
                        }
                      ],
                      width: "12px"
                    },
                    {
                      type: "text",
                      text: "อยู่ระหว่างการนำจ่าย",
                      gravity: "center",
                      flex: 4,
                      size: "xs",
                      color: "#8c8c8c"
                    }
                  ],
                  spacing: "lg",
                  height: "64px"
                },
                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    {
                      type: "text",
                      text: "09:00-11:59",
                      gravity: "center",
                      size: "sm",
                      flex: 2
                    },
                    {
                      type: "box",
                      layout: "vertical",
                      contents: [
                        {
                          type: "filler"
                        },
                        {
                          type: "box",
                          layout: "vertical",
                          contents: [
                            {
                              type: "filler"
                            }
                          ],
                          cornerRadius: "30px",
                          width: "12px",
                          height: "12px",
                          borderColor: "#42a441",
                          borderWidth: "2px"
                        },
                        {
                          type: "filler"
                        }
                      ],
                      flex: 0
                    },
                    {
                      type: "text",
                      text: "หลักสี่",
                      gravity: "center",
                      flex: 4,
                      size: "sm"
                    }
                  ],
                  spacing: "lg",
                  cornerRadius: "30px"
                },
                {
                  type: "text",
                  text: "27/04/2562",
                  color: "#000000",
                  size: "xxs"
                },
                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    {
                      type: "box",
                      layout: "baseline",
                      contents: [
                        {
                          type: "filler"
                        }
                      ],
                      flex: 2
                    },
                    {
                      type: "box",
                      layout: "vertical",
                      contents: [
                        {
                          type: "box",
                          layout: "horizontal",
                          contents: [
                            {
                              type: "filler"
                            },
                            {
                              type: "box",
                              layout: "vertical",
                              contents: [
                                {
                                  type: "filler"
                                }
                              ],
                              width: "2px",
                              backgroundColor: "#42a441"
                            },
                            {
                              type: "filler"
                            }
                          ],
                          flex: 1
                        }
                      ],
                      width: "12px"
                    },
                    {
                      type: "text",
                      text: "นำจ่ายสำเร็จ(22/87)",
                      gravity: "center",
                      flex: 4,
                      size: "xs",
                      color: "#8c8c8c"
                    }
                  ],
                  spacing: "lg",
                  height: "64px"
                }
              ]
            }
          }
        })
      case "testflex":
        return client.replyMessage(replyToken, {
          type: "flex",
          altText: "รายละเอียดสินค้า",
          contents: {
            type: "bubble",
            styles: {
              footer: {
                separator: true
              }
            },
            hero: {
              type: "image",
              url: "https://santipab.info/images/No_Image_Available.png",
              size: "full",
              aspectRatio: "20:13",
              aspectMode: "cover",
              action: {
                type: "uri",
                uri: "https://santipab.info/images/No_Image_Available.png"
              }
            },
            body: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "text",
                  text: "รายละเอียดสินค้า",
                  weight: "bold",
                  color: "#1DB446",
                  size: "sm"
                },
                {
                  type: "text",
                  text: "โปสการ์ด",
                  weight: "bold",
                  size: "xs",
                  margin: "md"
                },
                {
                  type: "separator",
                  margin: "xxl"
                },
                {
                  type: "box",
                  layout: "horizontal",
                  margin: "md",
                  contents: [
                    {
                      type: "text",
                      text: "ID",
                      size: "xs",
                      color: "#aaaaaa",
                      flex: 0
                    },
                    {
                      type: "text",
                      text: "#QO-2019092100004",
                      color: "#aaaaaa",
                      size: "xs",
                      align: "end"
                    }
                  ]
                },
                {
                  type: "box",
                  layout: "horizontal",
                  margin: "md",
                  contents: [
                    {
                      type: "text",
                      text: "ขนาด",
                      size: "sm",
                      color: "#555555",
                      flex: 0
                    },
                    {
                      type: "text",
                      text: "4*6",
                      size: "sm",
                      color: "#111111",
                      align: "end"
                    }
                  ]
                },
                {
                  type: "box",
                  layout: "horizontal",
                  margin: "md",
                  contents: [
                    {
                      type: "text",
                      text: "กระดาษ",
                      size: "sm",
                      color: "#555555",
                      flex: 0
                    },
                    {
                      type: "text",
                      text: "กรีนการ์ด 250 แกรม",
                      size: "sm",
                      color: "#111111",
                      align: "end"
                    }
                  ]
                },
                {
                  type: "box",
                  layout: "horizontal",
                  margin: "md",
                  contents: [
                    {
                      type: "text",
                      text: "พิมพ์",
                      size: "sm",
                      color: "#555555",
                      flex: 0
                    },
                    {
                      type: "text",
                      text: "สองหน้า พิมพ์ 4 สี",
                      size: "sm",
                      color: "#111111",
                      align: "end"
                    }
                  ]
                },
                {
                  type: "box",
                  layout: "horizontal",
                  margin: "md",
                  contents: [
                    {
                      type: "text",
                      text: "เคลือบ",
                      size: "sm",
                      color: "#555555",
                      flex: 0
                    },
                    {
                      type: "text",
                      text: "เคลือบ pvc ด้าน (สองด้าน)",
                      size: "sm",
                      color: "#111111",
                      align: "end"
                    }
                  ]
                },
                {
                  type: "separator",
                  margin: "xxl"
                },
                {
                  type: "box",
                  layout: "horizontal",
                  margin: "md",
                  contents: [
                    {
                      type: "text",
                      text: "จำนวน",
                      size: "sm",
                      color: "#ea7066",
                      flex: 0
                    },
                    {
                      type: "text",
                      text: "2,000 ชิ้น",
                      size: "sm",
                      color: "#ea7066",
                      align: "end"
                    }
                  ]
                },
                {
                  type: "box",
                  layout: "horizontal",
                  margin: "md",
                  contents: [
                    {
                      type: "text",
                      text: "ราคา",
                      size: "sm",
                      color: "#ea7066",
                      flex: 0
                    },
                    {
                      type: "text",
                      text: "฿9,600.00",
                      size: "sm",
                      color: "#ea7066",
                      align: "end"
                    }
                  ]
                }
              ]
            },
            footer: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "button",
                  color: "#905c44",
                  action: {
                    type: "uri",
                    label: "ดาวน์โหลดใบเสนอราคา",
                    uri:
                      "https://santipab.info/app/product/quo?q=QO-2019092100004"
                  }
                }
              ]
            }
          }
        })
      default:
        console.log(`Echo message to ${replyToken}: ${message.text}`)
        // createQRCode(source.userId, replyToken)
        return postToDialogflow(req, req.body)
      // return replyText(replyToken, message.text);
    }
  }
}

function handleImage(message, replyToken) {
  let getContent
  if (message.contentProvider.type === "line") {
    const downloadPath = path.join(__dirname, "downloaded", `${message.id}.jpg`)
    const previewPath = path.join(
      __dirname,
      "downloaded",
      `${message.id}-preview.jpg`
    )

    getContent = downloadContent(message.id, downloadPath).then(
      downloadPath => {
        // ImageMagick is needed here to run 'convert'
        // Please consider about security and performance by yourself
        cp.execSync(
          `convert -resize 240x jpeg:${downloadPath} jpeg:${previewPath}`
        )

        return {
          originalContentUrl:
            baseURL + "/downloaded/" + path.basename(downloadPath),
          previewImageUrl: baseURL + "/downloaded/" + path.basename(previewPath)
        }
      }
    )
  } else if (message.contentProvider.type === "external") {
    getContent = Promise.resolve(message.contentProvider)
  }

  return getContent.then(({ originalContentUrl, previewImageUrl }) => {
    return client.replyMessage(replyToken, {
      type: "image",
      originalContentUrl,
      previewImageUrl
    })
  })
}

function handleVideo(message, replyToken) {
  let getContent
  if (message.contentProvider.type === "line") {
    const downloadPath = path.join(__dirname, "downloaded", `${message.id}.mp4`)
    const previewPath = path.join(
      __dirname,
      "downloaded",
      `${message.id}-preview.jpg`
    )

    getContent = downloadContent(message.id, downloadPath).then(
      downloadPath => {
        // FFmpeg and ImageMagick is needed here to run 'convert'
        // Please consider about security and performance by yourself
        cp.execSync(`convert mp4:${downloadPath}[0] jpeg:${previewPath}`)

        return {
          originalContentUrl:
            baseURL + "/downloaded/" + path.basename(downloadPath),
          previewImageUrl: baseURL + "/downloaded/" + path.basename(previewPath)
        }
      }
    )
  } else if (message.contentProvider.type === "external") {
    getContent = Promise.resolve(message.contentProvider)
  }

  return getContent.then(({ originalContentUrl, previewImageUrl }) => {
    return client.replyMessage(replyToken, {
      type: "video",
      originalContentUrl,
      previewImageUrl
    })
  })
}

function handleAudio(message, replyToken) {
  let getContent
  if (message.contentProvider.type === "line") {
    const downloadPath = path.join(__dirname, "downloaded", `${message.id}.m4a`)

    getContent = downloadContent(message.id, downloadPath).then(
      downloadPath => {
        return {
          originalContentUrl:
            baseURL + "/downloaded/" + path.basename(downloadPath)
        }
      }
    )
  } else {
    getContent = Promise.resolve(message.contentProvider)
  }

  return getContent.then(({ originalContentUrl }) => {
    return client.replyMessage(replyToken, {
      type: "audio",
      originalContentUrl,
      duration: message.duration
    })
  })
}

function downloadContent(messageId, downloadPath) {
  return client.getMessageContent(messageId).then(
    stream =>
      new Promise((resolve, reject) => {
        const writable = fs.createWriteStream(downloadPath)
        stream.pipe(writable)
        stream.on("end", () => resolve(downloadPath))
        stream.on("error", reject)
      })
  )
}

function handleLocation(message, replyToken) {
  return client.replyMessage(replyToken, {
    type: "location",
    title: message.title,
    address: message.address,
    latitude: message.latitude,
    longitude: message.longitude
  })
}

function handleSticker(message, replyToken) {
  return client.replyMessage(replyToken, {
    type: "sticker",
    packageId: message.packageId,
    stickerId: message.stickerId
  })
}

async function handleProduct(replyToken) {
  try {
    const flexs = await fetchDataProductCategory()
    // console.log("\n\n")
    // console.log(JSON.stringify(flex))
    client.replyMessage(replyToken, flexs)
  } catch (error) {
    console.log(error)
  }
}

const updateObject = (oldObject, updatedProperties) => {
  return {
    ...oldObject,
    ...updatedProperties
  }
}

const imageBox = {
  type: "image",
  url: "",
  margin: "md",
  // size: "full",
  aspectRatio: "4:3",
  aspectMode: "fit",
  align: "center",
  action: {
    type: "message",
    label: "image",
    text: "image"
  }
}

const textBox = {
  type: "text",
  text: "",
  size: "xxs",
  align: "center",
  color: "#905c44",
  weight: "bold",
  action: {
    type: "message",
    label: "text",
    text: "text"
  }
}

const boxObj = {
  type: "box",
  layout: "horizontal",
  contents: []
}

const keywordCategory = []

const fetchDataProductCategory = async () => {
  try {
    const { data } = await axios.get(
      "https://santipab.info/app/api/product-category-list"
    )
    const items = await data
    return mapItemFlex(items)
  } catch (error) {
    console.log(error)
  }
}

function mapItemFlex(items) {
  let images = []
  let texts = []
  let bodyContents = []
  const flexs = []
  const flex = {
    type: "flex",
    altText: "หมวดหมู่สินค้า",
    contents: {
      type: "bubble",
      size: "giga",
      header: {
        type: "box",
        layout: "horizontal",
        contents: [
          {
            type: "text",
            text: "เลือกหมวดหมู่สินค้า",
            size: "lg",
            weight: "bold",
            color: "#ea7066"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        borderColor: "#aaaaaa",
        backgroundColor: "#f9f9fc",
        paddingTop: "20px",
        paddingAll: "10px",
        paddingStart: "10px",
        cornerRadius: "md",
        contents: []
      },
      footer: {
        type: "box",
        layout: "horizontal",
        margin: "xs",
        paddingTop: "10px",
        paddingAll: "10px",
        paddingStart: "10px",
        contents: [
          {
            type: "button",
            color: "#905c44",
            height: "sm",
            action: {
              type: "uri",
              label: "ดูผลิตภัณฑ์อื่นๆ",
              uri: "https://line.me/R/app/1583147071-w3v6DmZZ"
            }
          }
        ]
      }
    }
  }
  const total = items.length
  items.map((item, index) => {
    if (!keywordCategory.includes(item.product_category_name)) {
      keywordCategory.push(item.product_category_name.toLowerCase())
    }
    if (index + 1 < 80) {
      let action = {}
      if (item.product_category_name.length > 20) {
        action = {
          type: "message",
          label: item.product_category_name.substring(0, 17) + "...",
          text: item.product_category_name
        }
      } else {
        action = {
          type: "message",
          label: item.product_category_name,
          text: item.product_category_name
        }
      }
      const image = updateObject(imageBox, {
        url: item.image_url,
        action: action
      })
      const text = updateObject(textBox, {
        text: item.product_category_name,
        action: action
      })
      if (images.length < 3) {
        images.push(image)
      }
      if (images.length === 3 || index + 1 === total) {
        const box = updateObject(boxObj, {
          contents: images
        })
        bodyContents.push(box)
        images = [] // clear
      }
      //
      if (texts.length < 3) {
        texts.push(text)
      }
      if (texts.length === 3 || index + 1 === total) {
        const box = updateObject(boxObj, {
          contents: texts
        })
        bodyContents.push(box)
        texts = [] // clear
      }
      if (bodyContents.length === 10) {
        const body = updateObject(flex.contents.body, {
          contents: bodyContents
        })
        const newContents = updateObject(flex.contents, {
          body: body
        })
        flexs.push(
          updateObject(flex, {
            contents: newContents
          })
        )
        bodyContents = []
      } else if (index + 1 === total) {
        const body = updateObject(flex.contents.body, {
          contents: bodyContents
        })
        const newContents = updateObject(flex.contents, {
          body: body
        })
        flexs.push(
          updateObject(flex, {
            contents: newContents
          })
        )
        bodyContents = []
      }
    }
  })
  return flexs
}

function mapItemFlexProduct(items) {
  let images = []
  let texts = []
  let bodyContents = []
  const flexs = []
  const flex = {
    type: "flex",
    altText: "สินค้า",
    contents: {
      type: "bubble",
      size: "giga",
      header: {
        type: "box",
        layout: "horizontal",
        contents: [
          {
            type: "text",
            text: "เลือกสินค้า",
            size: "lg",
            weight: "bold",
            color: "#ea7066"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        borderColor: "#aaaaaa",
        backgroundColor: "#f9f9fc",
        paddingTop: "20px",
        paddingAll: "10px",
        paddingStart: "10px",
        cornerRadius: "md",
        contents: []
      },
      footer: {
        type: "box",
        layout: "horizontal",
        margin: "xs",
        paddingTop: "10px",
        paddingAll: "10px",
        paddingStart: "10px",
        contents: [
          {
            type: "button",
            color: "#905c44",
            height: "sm",
            action: {
              type: "uri",
              label: "ดูผลิตภัณฑ์อื่นๆ",
              uri: "https://line.me/R/app/1583147071-w3v6DmZZ"
            }
          }
        ]
      }
    }
  }
  const total = items.length
  items.map((item, index) => {
    if (index + 1 < 80) {
      let action = {}
      const url = `https://line.me/R/app/1583147071-w3v6DmZZ?catId=${item.product_category_id}&productId=${item.product_id}`
      if (item.product_name.length > 20) {
        action = {
          type: "uri",
          label: item.product_name.substring(0, 17) + "...",
          uri: url,
          altUri: {
            desktop: url
          }
        }
      } else {
        action = {
          type: "uri",
          label: item.product_name,
          uri: url,
          altUri: {
            desktop: url
          }
        }
      }
      const image = updateObject(imageBox, {
        url: item.image_url,
        action: action
      })
      const text = updateObject(textBox, {
        text: item.product_name,
        action: action
      })
      if (images.length < 3) {
        images.push(image)
      }
      if (images.length === 3 || index + 1 === total) {
        const box = updateObject(boxObj, {
          contents: images
        })
        bodyContents.push(box)
        images = [] // clear
      }
      //
      if (texts.length < 3) {
        texts.push(text)
      }
      if (texts.length === 3 || index + 1 === total) {
        const box = updateObject(boxObj, {
          contents: texts
        })
        bodyContents.push(box)
        texts = [] // clear
      }
      if (bodyContents.length === 10) {
        const body = updateObject(flex.contents.body, {
          contents: bodyContents
        })
        const newContents = updateObject(flex.contents, {
          body: body
        })
        flexs.push(
          updateObject(flex, {
            contents: newContents
          })
        )
        bodyContents = []
      } else if (index + 1 === total) {
        const body = updateObject(flex.contents.body, {
          contents: bodyContents
        })
        const newContents = updateObject(flex.contents, {
          body: body
        })
        flexs.push(
          updateObject(flex, {
            contents: newContents
          })
        )
        bodyContents = []
      }
    }
  })
  return flexs
}

const productItems = []
const keywords = []
async function GetAllProduct() {
  try {
    const { data } = await axios.get(
      "https://santipab.info/app/api/get-all-product"
    )
    productItems.push(...data.items)
    keywords.push(...data.keywords)
  } catch (error) {
    console.log(error)
  }
}

GetAllProduct()

function createQRCode(filename = "qrcode", replyToken) {
  const savePath = path.join(__dirname, "downloaded", `qr-${filename}.png`)
  QRCode.toFile(
    savePath,
    "https://bots.dialogflow.com",
    {
      errorCorrectionLevel: "M",
      margin: 4
    },
    function(err) {
      if (err) throw err
      console.log("done")
      return client.replyMessage(replyToken, {
        type: "image",
        originalContentUrl:
          "https://659d22d5.ngrok.io/downloaded/" + path.basename(savePath),
        previewImageUrl:
          "https://659d22d5.ngrok.io/downloaded/" + path.basename(savePath)
      })
    }
  )
}

const postToDialogflow = (req, body) => {
  req.headers.host = "bots.dialogflow.com"
  return request
    .post({
      uri: `https://bots.dialogflow.com/line/${process.env.AGENT_ID}/webhook`,
      headers: req.headers,
      body: JSON.stringify(body)
    })
    .catch(error => {
      console.error(error)
    })
}

// client
const BASE_URL_API = "https://trackapi.thailandpost.co.th/post/api/v1"
const AUTH_TOKEN =
  "YUQuUXWMLWDNdFiM9G^CEVfEdDIIeRFE$FCRZUmP=EBBsNMVsH_I*OPFvVdL=F0MI_IGWYRdK?ZGM_JxZ!EJQOYlKAXjIbD!Lw"

axios.defaults.baseURL = BASE_URL_API
axios.defaults.headers.common["Authorization"] = `Token ${AUTH_TOKEN}`
axios.defaults.headers.post["Content-Type"] = "application/json"

function trackingEMS() {
  // const url =
  //   "https://trackapisoap.thailandpost.co.th/TTPOSTWebService/TrackandTrace.wsdl";
  // const args = {
  //   username: "username",
  //   password: "1234",
  //   lang: "TH",
  //   Barcode: "EP881542195TH"
  // };
  // const options = {};
  // soap.createClient(url, options, function(err, client) {
  //   console.log(client)
  //   /* client.GetItems(args, function(err, result) {
  //     console.log(result);
  //   }); */
  // });
  axios
    .post("/token", {})
    .then(function(response) {
      console.log(response)
    })
    .catch(function(error) {
      console.log(error)
    })
}

const res = {
  response: {
    items: {
      EP881542195TH: [
        {
          barcode: "EP881542195TH",
          status: "EMA",
          status_description: "รับฝาก",
          status_date: "26/04/2562 11:09:05+07:00",
          location: "รองเมือง",
          postcode: "10330",
          delivery_status: null,
          delivery_description: null,
          delivery_datetime: null,
          receiver_name: null,
          signature: null
        },
        {
          barcode: "EP881542195TH",
          status: "D010",
          status_description: "อยู่ระหว่างการขนส่ง",
          status_date: "26/04/2562 17:09:18+07:00",
          location: "รองเมือง",
          postcode: "10330",
          delivery_status: null,
          delivery_description: null,
          delivery_datetime: null,
          receiver_name: null,
          signature: null
        },
        {
          barcode: "EP881542195TH",
          status: "EDG",
          status_description: "อยู่ระหว่างการนำจ่าย",
          status_date: "27/04/2562 08:55:47+07:00",
          location: "หลักสี่",
          postcode: "10210",
          delivery_status: null,
          delivery_description: null,
          delivery_datetime: null,
          receiver_name: null,
          signature: null
        },
        {
          barcode: "EP881542195TH",
          status: "EMI",
          status_description: "นำจ่ายสำเร็จ",
          status_date: "27/04/2562 11:59:59+07:00",
          location: "หลักสี่",
          postcode: "10210",
          delivery_status: "S",
          delivery_description: "ผู้รับได้รับสิ่งของเรียบร้อยแล้ว",
          delivery_datetime: "27/04/2562 0900-1159",
          receiver_name: "22/87",
          signature:
            "https://track2.thailandpost.co.th/signature/QDQyMTk1YjVzMGx1VDMz/QGI1c0VQMGx1VDMx/QGI1czBsVEh1VDM0/QGI1czBsdTg4MTVUMzI="
        }
      ]
    },
    track_count: {
      track_date: "20/09/2562",
      count_number: 1,
      track_count_limit: 1000
    }
  },
  message: "successful",
  status: true
}

// trackingEMS();

// listen on port
module.exports = app;
module.exports.handler = serverless(app);
// const port = process.env.PORT || 5000
// app.listen(port, () => {
//   if (baseURL) {
//     console.log(`listening on ${baseURL}:${port}/callback`)
//   } else {
//     console.log("It seems that BASE_URL is not set. Connecting to ngrok...")
//     ngrok.connect(port, (err, url) => {
//       if (err) throw err

//       baseURL = url
//       console.log(`listening on ${baseURL}/callback`)
//     })
//   }
// })

/* 
{
  "line": {
    "type": "template",
    "altText": "Datetime pickers alt text",
    "template": {
      "type": "buttons",
      "text": "Select date / time !",
      "actions": [
        {
          "type": "datetimepicker",
          "label": "date",
          "data": "DATE",
          "mode": "date"
        },
        {
          "type": "datetimepicker",
          "label": "time",
          "data": "TIME",
          "mode": "time"
        },
        {
          "type": "datetimepicker",
          "label": "datetime",
          "data": "DATETIME",
          "mode": "datetime"
        }
      ]
    }
  }
}
*/
