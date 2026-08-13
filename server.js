require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const WebSocket = require("ws");
const tmi = require("tmi.js");

const PORT = Number(process.env.PORT || 3000);

const CHANNEL =
  process.env.TWITCH_CHANNEL;

const API_KEY =
  process.env.SPEECHIFY_API_KEY;

const VOICES = [
  "wyatt_32",
  "dominic_32",
  "beatrice_32"
];

const MODEL =
  process.env.SPEECHIFY_MODEL ||
  "simba-3.2";

const COOLDOWN_MS =
  Number(
    process.env.COOLDOWN_SECONDS || 1
  ) * 1000;

const MAX_LENGTH =
  Number(
    process.env.MAX_MESSAGE_LENGTH || 200
  );


// -----------------------------
// Validation
// -----------------------------

if (!CHANNEL) {
  console.error(
    "Missing TWITCH_CHANNEL in .env"
  );

  process.exit(1);
}

if (!API_KEY) {
  console.error(
    "Missing SPEECHIFY_API_KEY in .env"
  );

  process.exit(1);
}


// -----------------------------
// State
// -----------------------------

const queue = [];

let processing = false;

let lastMessageTime = 0;

let enabled = true;


// -----------------------------
// Temporary audio directory
// -----------------------------

const AUDIO_DIR =
  path.join(
    __dirname,
    "tts-audio"
  );

if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR);
}


// -----------------------------
// Web server
// -----------------------------

const server =
  http.createServer(
    (req, res) => {

      if (
        req.url === "/" ||
        req.url === "/index.html"
      ) {

        const file =
          path.join(
            __dirname,
            "index.html"
          );

        if (!fs.existsSync(file)) {

          res.writeHead(404);

          res.end(
            "index.html has not been created yet."
          );

          return;
        }

        res.writeHead(
          200,
          {
            "Content-Type":
              "text/html; charset=utf-8"
          }
        );

        res.end(
          fs.readFileSync(file)
        );

        return;
      }

      res.writeHead(404);

      res.end(
        "Not found"
      );
    }
  );


// -----------------------------
// WebSocket
// -----------------------------

const wss =
  new WebSocket.Server({
    server
  });


function broadcast(data) {

  const message =
    JSON.stringify(data);

  for (
    const client of wss.clients
  ) {

    if (
      client.readyState ===
      WebSocket.OPEN
    ) {

      client.send(message);
    }
  }
}


// -----------------------------
// Clean Twitch messages
// -----------------------------

function cleanMessage(message) {

  let text = message;

  text =
    text.replace(
      /https?:\/\/\S+/gi,
      ""
    );

  text =
    text.replace(
      /\s+/g,
      " "
    ).trim();

  text =
    text.replace(
      /(.)\1{8,}/g,
      "$1$1$1"
    );

  return text.slice(
    0,
    MAX_LENGTH
  );
}


// -----------------------------
// Speechify
// -----------------------------

async function generateSpeech(text, voice) {

  console.log(
    "🎙️ Requesting Speechify audio..."
  );

  const response =
    await fetch(
      "https://api.speechify.ai/v1/audio/speech",
      {
        method: "POST",

        headers: {
          "Authorization":
            `Bearer ${API_KEY}`,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          input: text,
          voice_id: voice,
          audio_format: "mp3",
          model: MODEL
        })
      }
    );

  if (!response.ok) {

    const error =
      await response.text();

    throw new Error(
      `Speechify ${response.status}: ${error}`
    );
  }

  const data =
    await response.json();

  if (!data.audio_data) {

    throw new Error(
      "Speechify returned no audio data."
    );
  }

  console.log(
    `✅ Speechify audio received (${data.audio_data.length} characters)`
  );

  return data.audio_data;
}


// -----------------------------
// Save MP3
// -----------------------------

function saveAudio(
  base64Audio,
  filename
) {

  const filePath =
    path.join(
      AUDIO_DIR,
      filename
    );

  const buffer =
    Buffer.from(
      base64Audio,
      "base64"
    );

  fs.writeFileSync(
    filePath,
    buffer
  );

  return filePath;
}


// -----------------------------
// Play audio with macOS
// -----------------------------

function playAudio(
  filePath
) {

  return new Promise(
    (resolve, reject) => {

      console.log(
        `🔊 Playing: ${path.basename(filePath)}`
      );

      execFile(
        "/usr/bin/afplay",
        [
          filePath
        ],
        error => {

          if (error) {

            reject(error);

            return;
          }

          resolve();
        }
      );
    }
  );
}


// -----------------------------
// Queue
// -----------------------------

async function processQueue() {

  if (
    processing ||
    queue.length === 0
  ) {

    return;
  }

  processing = true;

  const item =
    queue.shift();

  console.log(
    `🔊 Speaking ${item.username}: ${item.text}`
  );

  broadcast({
    type: "speaking",

    username:
      item.username,

    text:
      item.text,

    queueLength:
      queue.length
  });


  let filePath = null;


  try {

    const speechText =
      `${item.username} says: ${item.text}`;

    const voice =
      VOICES[
        Math.floor(
          Math.random() * VOICES.length
        )
      ];

    console.log(
      `🎙️ Selected voice: ${voice}`
    );

    const audio =
      await generateSpeech(
        speechText,
        voice
      );


    const filename =
      `tts-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.mp3`;


    filePath =
      saveAudio(
        audio,
        filename
      );


    broadcast({
      type: "audio",

      username:
        item.username,

      text:
        item.text,

      queueLength:
        queue.length
    });


    await playAudio(
      filePath
    );


    console.log(
      "✅ Finished speaking."
    );


  } catch (error) {

    console.error(
      "❌ TTS error:",
      error.message
    );


    broadcast({
      type: "error",

      message:
        error.message
    });


  } finally {

    if (
      filePath &&
      fs.existsSync(filePath)
    ) {

      try {

        fs.unlinkSync(
          filePath
        );

      } catch {
        // Ignore cleanup errors.
      }
    }


    processing = false;


    setTimeout(
      processQueue,
      100
    );
  }
}


// -----------------------------
// Add to queue
// -----------------------------

function addToQueue(
  username,
  message
) {

  if (!enabled) {
    return;
  }


  if (
    message.startsWith("!")
  ) {

    return;
  }


  const now =
    Date.now();


  if (
    now - lastMessageTime <
    COOLDOWN_MS
  ) {

    return;
  }


  const text =
    cleanMessage(
      message
    );


  if (!text) {
    return;
  }


  if (
    queue.length >= 20
  ) {

    console.log(
      "⚠️ TTS queue is full."
    );

    return;
  }


  lastMessageTime =
    now;


  queue.push({
    username,
    text
  });


  console.log(
    `💬 ${username}: ${text}`
  );


  broadcast({
    type: "queued",

    username,

    text,

    queueLength:
      queue.length
  });


  processQueue();
}


// -----------------------------
// Twitch
// -----------------------------

const twitch =
  new tmi.Client({

    options: {
      debug: true
    },

    channels: [
      CHANNEL
    ]
  });


twitch.on(
  "connected",
  () => {

    console.log(
      `✅ Connected to Twitch: #${CHANNEL}`
    );


    broadcast({
      type: "twitch",

      connected: true,

      channel:
        CHANNEL
    });
  }
);


twitch.on(
  "disconnected",
  () => {

    console.log(
      "❌ Disconnected from Twitch."
    );


    broadcast({
      type: "twitch",

      connected: false
    });
  }
);


twitch.on(
  "message",
  (
    channel,
    tags,
    message,
    self
  ) => {

    if (self) {
      return;
    }


    const username =
      tags["display-name"] ||
      tags.username ||
      "Someone";


    const command =
      message
        .toLowerCase()
        .trim();


    if (
      command === "!tts on"
    ) {

      enabled = true;


      broadcast({
        type: "enabled",

        enabled: true
      });


      return;
    }


    if (
      command === "!tts off"
    ) {

      enabled = false;


      broadcast({
        type: "enabled",

        enabled: false
      });


      return;
    }


    if (
      command === "!tts clear"
    ) {

      queue.length = 0;


      broadcast({
        type: "queue",

        queueLength: 0
      });


      return;
    }


    addToQueue(
      username,
      message
    );
  }
);


twitch
  .connect()
  .catch(
    error => {

      console.error(
        "Twitch connection failed:",
        error
      );
    }
  );


// -----------------------------
// Browser controls
// -----------------------------

wss.on(
  "connection",
  socket => {

    socket.send(
      JSON.stringify({
        type: "state",

        enabled,

        queueLength:
          queue.length,

        channel:
          CHANNEL
      })
    );


    socket.on(
      "message",
      raw => {

        try {

          const data =
            JSON.parse(
              raw.toString()
            );


          if (
            data.type === "toggle"
          ) {

            enabled =
              Boolean(
                data.enabled
              );


            broadcast({
              type: "enabled",

              enabled
            });
          }


          if (
            data.type === "clear"
          ) {

            queue.length = 0;


            broadcast({
              type: "queue",

              queueLength: 0
            });
          }


        } catch {

          // Ignore malformed messages.
        }
      }
    );
  }
);


// -----------------------------
// Start
// -----------------------------

server.listen(
  PORT,
  () => {

    console.log("");

    console.log(
      "================================"
    );

    console.log(
      "  Twitch → Speechify TTS"
    );

    console.log(
      "================================"
    );

    console.log(
      `Channel: #${CHANNEL}`
    );

    console.log(
      `Voices:  ${VOICES.join(", ")}`
    );

    console.log(
      `Model:   ${MODEL}`
    );

    console.log(
      "Audio:   macOS afplay"
    );

    console.log("");

    console.log(
      `Open: http://localhost:${PORT}`
    );

    console.log("");
  }
);
