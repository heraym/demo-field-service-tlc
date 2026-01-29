/**************************
 * gemini-connection.js
 **************************/
import WebSocket from "ws";
import logger from "./logger.js";

export class GeminiConnection {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.model = "gemini-2.0-flash-exp";
    //this.model = "gemini-2.5-flash-native-audio-preview-12-2025"
    this.uri = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
    this.ws = null;
    this.config = null;
    this.connected = false; // Track if the Gemini WS is truly open

    if (!this.apiKey) {
      logger.warn(
        "[GeminiConnection] GEMINI_API_KEY not found in environment!"
      );
    }
  }

  setConfig(config) {
    this.config = config;
  }

  isOpen() {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  async connect() {
    if (!this.config) {
      throw new Error(
        "[GeminiConnection] Configuration must be set before connecting."
      );
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.uri, {
          headers: { "Content-Type": "application/json" },
        });

        this.ws.on("open", () => {
          logger.info("[GeminiConnection] WebSocket opened to Gemini");
          this.connected = true;

          try {
            const setupMessage = {
              setup: {
                model: `models/${this.model}`,
                generation_config: {
                  response_modalities: ["TEXT"],
                },
                system_instruction: {
                  parts: [
                    {
                      text: this.config.systemPrompt || "",
                    },
                  ],
                },
              },
            };

            // If the config has tools, attach them:
            if (this.config.tools && Array.isArray(this.config.tools)) {
              setupMessage.setup.tools = this.config.tools;
            }

            logger.debug("[GeminiConnection] Sending setup message to Gemini");
            this.ws.send(JSON.stringify(setupMessage), (err) => {
              if (err) {
                logger.error(
                  "[GeminiConnection] Error sending setup message:",
                  err
                );
                return reject(err);
              }
            });
          } catch (err) {
            logger.error(
              "[GeminiConnection] Error building setup message:",
              err
            );
            return reject(err);
          }
        });

        // The first "message" from Gemini is the setup response
        this.ws.once("message", (data) => {
          logger.info("[GeminiConnection] Received setup response");
          resolve(data);
        });

        this.ws.on("error", (err) => {
          logger.error("[GeminiConnection] WebSocket error:", err);
          reject(err);
        });

        this.ws.on("close", (code, reason) => {
          this.connected = false;
          logger.warn(
            `[GeminiConnection] WebSocket closed. code=${code}, reason=${
              reason || "<no reason>"
            }`
          );
        });
      } catch (err) {
        logger.error("[GeminiConnection] Error creating WebSocket:", err);
        reject(err);
      }
    });
  }

  async receive() {
    if (!this.isOpen()) {
      throw new Error(
        "[GeminiConnection] WebSocket is not open. Cannot receive."
      );
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws.once("message", (data) => {
          resolve(data.toString());
        });
        this.ws.once("error", (err) => {
          logger.error(
            "[GeminiConnection] Error while waiting for message:",
            err
          );
          reject(err);
        });
        this.ws.once("close", (code, reason) => {
          logger.warn(
            `[GeminiConnection] Socket closed while receiving. code=${code}, reason=${reason}`
          );
          resolve(null);
        });
      } catch (err) {
        logger.error("[GeminiConnection] receive() error:", err);
        reject(err);
      }
    });
  }

   

  async sendImage(imageData) {
    logger.debug("[GeminiConnection] Sending image data to Gemini");
    // La estructura debe ser client_content para que Gemini la procese como un turno completo.
    // La estructura realtime_input es para streaming y no genera una respuesta de texto directa.
    const message = {
      client_content: {
        turns: [
          {
            role: "user",
            parts: [
              { text: "Describeme la imagen" }, // Texto que acompaña a la imagen
              { inline_data: { mime_type: "image/jpeg", data: imageData } },
            ],
          },
        ],
        turn_complete: true,
      },
    };
    await this._sendJson(message);
  }

  async sendText(text) {
    logger.debug("[GeminiConnection] Sending text to Gemini:", text);
    
    // For text, we mark turn_complete=true by default
    const message = {
      client_content: {
        turns: [
          {
            role: "user",
            parts: [{ text }],
          },
        ],
        turn_complete: true,
      },
    };
    await this._sendJson(message);
  }

  /**
   * Called when the client wants to say "I'm still here, keep going" => turn_complete: false
   * Pass in an optional pre-built object if you like, or we just build a standard "empty user parts" message
   */
  async sendContinue(clientContent) {
    let msg;
    if (clientContent) {
      msg = clientContent; // assume user provided the structure
    } else {
      msg = {
        client_content: {
          turns: [
            {
              role: "user",
              parts: [],
            },
          ],
          turn_complete: false,
        },
      };
    }
    logger.debug("[GeminiConnection] sendContinue =>", msg);
    await this._sendJson(msg);
  }

  /**
   * Called when the client wants to say "That's it, my turn is done" => turn_complete: true
   */
  async sendEnd(clientContent) {
    let msg;
    if (clientContent) {
      msg = clientContent;
    } else {
      msg = {
        client_content: {
          turns: [
            {
              role: "user",
              parts: [],
            },
          ],
          turn_complete: true,
        },
      };
    }
    logger.debug("[GeminiConnection] sendEnd =>", msg);
    await this._sendJson(msg);
  }

  async close() {
    if (this.isOpen()) {
      logger.info("[GeminiConnection] Closing WebSocket");
      return new Promise((resolve, reject) => {
        try {
          this.ws.on("close", (code, reason) => {
            logger.info(
              `[GeminiConnection] WebSocket closed. code=${code}, reason=${
                reason || "<no reason>"
              }`
            );
            this.connected = false;
            // Clear internal state
            this.config = null;
            this.ws = null;
            resolve();
          });
          this.ws.close();
        } catch (err) {
          logger.error("[GeminiConnection] Error closing WebSocket:", err);
          reject(err);
        }
      });
    } else {
      logger.info(
        "[GeminiConnection] WebSocket is not open or already closed."
      );
      // Even if not open, clear state
      this.config = null;
      this.ws = null;
      this.connected = false;
    }
  }

  async _sendJson(obj) {
    if (!this.isOpen()) {
      throw new Error(
        "[GeminiConnection] WebSocket not open or not connected yet."
      );
    }

    return new Promise((resolve, reject) => {
      try {
        const dataStr = JSON.stringify(obj);
        this.ws.send(dataStr, (err) => {
          if (err) {
            logger.error("[GeminiConnection] Error sending JSON:", err);
            reject(err);
          } else {
            resolve();
          }
        });
      } catch (jsonErr) {
        logger.error("[GeminiConnection] JSON.stringify error:", jsonErr);
        reject(jsonErr);
      }
    });
  }
}

export async function sendJsonSafe(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return new Promise((resolve, reject) => {
      try {
        const jsonStr = JSON.stringify(obj);
        ws.send(jsonStr, (err) => {
          if (err) {
            logger.error("[sendJsonSafe] Error sending to client:", err);
            return reject(err);
          }
          resolve();
        });
      } catch (err) {
        logger.error("[sendJsonSafe] JSON.stringify error:", err);
        reject(err);
      }
    });
  } else {
    logger.warn("[sendJsonSafe] WebSocket not open, cannot send message");
  }
}
