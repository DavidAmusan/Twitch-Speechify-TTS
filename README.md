# Twitch-Speechify-TTS-for-Godisincontroll
Twitch chat Text to speech using Speechify Voice overs
# 🎙️ Twitch → Speechify TTS

A lightweight Twitch chat text-to-speech system using:

- Twitch chat
- Speechify API
- Node.js
- WebSockets
- macOS native audio playback

The important part of this project is that **audio is played directly by macOS using `afplay`**, rather than through the browser.

This means Twitch TTS can continue speaking while:

- 🎮 League of Legends is running
- 🖥️ League is in Borderless Windowed mode
- 🌐 Safari is in the background
- 🔒 The browser is not focused

---

# ✨ Features

- Connects directly to a Twitch channel
- Reads Twitch chat messages aloud
- Uses Speechify voices
- Randomly selects a voice for each message
- Supports multiple Speechify voices
- Message queue
- Configurable cooldown
- Maximum message length
- URL filtering
- Basic spam protection
- `!tts on`
- `!tts off`
- `!tts clear`
- Browser control panel
- macOS-native audio playback
- Works while gaming in Borderless Windowed mode

---

# 🖥️ Requirements

This project currently targets **macOS**.

You need:

- macOS
- Node.js 18+
- npm
- A Twitch account
- A Speechify API key
- Internet connection
- Audio output such as headphones or speakers

The project uses the macOS command:

```bash
/usr/bin/afplay
