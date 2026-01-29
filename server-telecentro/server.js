/**************************
 * server.js
 **************************/
import "dotenv/config"; // For loading .env
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import http from "http";
import logger from "./logger.js";
import { GeminiConnection, sendJsonSafe } from "./gemini-connection.js";
import { toolHandlers } from "./functions.js";

const app = express();

// Map of clientId -> { clientWs, geminiConn }
const connections = new Map();

// Add CORS
app.use(
  cors({
    origin: "*",
    credentials: true,
  })
);

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });


server.on("upgrade", (request, socket, head) => {
  try {
    const path = request.url || "";
    const match = path.match(/^\/ws\/([^/]+)/);

    if (!match) {
      logger.error("[Upgrade] No valid clientId in URL:", path);
      socket.destroy();
      return;
    }

    const clientId = match[1];
    logger.info(`[Upgrade] Upgrading connection for clientId=${clientId}`);

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, clientId);
    });
  } catch (err) {
    logger.error("[Upgrade] Error during upgrade:", err);
    socket.destroy();
  }
});

wss.on("connection", async (clientWs, request, clientId) => {
  logger.info(`[Connection] Client connected with ID: ${clientId}`);

  const geminiConn = new GeminiConnection();
  connections.set(clientId, { clientWs, geminiConn });

  let configReceived = false;

  clientWs.on("message", async (rawData) => {
    try {
      const message = JSON.parse(rawData.toString());
      const { type, config, data } = message;

      if (!configReceived) {
        // First message must be config
        if (type !== "config") {
          const errorMsg =
            "[ClientMessage] First message must be 'config'. Closing connection.";
          logger.error(errorMsg);
          clientWs.close(1011, errorMsg);
          return;
        }

        configReceived = true;
        try {
          if (!config || typeof config !== "object") {
            throw new Error("Invalid config received");
          }
          geminiConn.setConfig(config);

          logger.info(
            `[ClientMessage] Connecting to Gemini for client=${clientId}...`
          );
          const setupResponse = await geminiConn.connect();
          logger.info(
            `[GeminiSetup] Gemini responded with (client=${clientId}): ${setupResponse.toString()}`
          );

          // Once Gemini is connected, tell the client
          await sendJsonSafe(clientWs, {
            type: "gemini_ready",
            data: true,
          });
          logger.info(`[GeminiSetup] gemini_ready sent to client=${clientId}`);

          // Start reading from Gemini => forward to client
          receiveFromGemini(clientWs, geminiConn, clientId);
        } catch (err) {
          logger.error(
            `[ClientMessage] Failed to configure/connect to Gemini for client=${clientId}:`,
            err
          );
          clientWs.close(1011, "Failed to connect Gemini");
          return;
        }
      } else {
        // Subsequent messages from client
        switch (type) {         

          case "image":
            console.log("Recibe imagen");
            logger.debug(`[ClientMessage] image data for client=${clientId}`);
            if (!geminiConn.isOpen()) {
              logger.debug(
                `[ClientMessage] Gemini not open for image, ignoring client=${clientId}.`
              );
              return;
            }
            await geminiConn.sendImage(data);
            break;

          case "text":
             
            logger.debug(
              `[ClientMessage] text data for client=${clientId}:`,
              data
            );
            if (!geminiConn.isOpen()) {
              logger.debug(
                `[ClientMessage] Gemini not open for text, ignoring client=${clientId}.`
              );
              return;
            }
            await geminiConn.sendText(data);
            break;

          case "continue":
            // Turn not done => keep streaming
            logger.debug(
              `[ClientMessage] continue data for client=${clientId}:`
            );
            if (!geminiConn.isOpen()) return;
            await geminiConn.sendContinue(data?.data);
            break;

          case "end":
            // Turn is complete => finalize
            logger.debug(`[ClientMessage] end data for client=${clientId}:`);
            if (!geminiConn.isOpen()) return;
            await geminiConn.sendEnd(data?.data);
            break;

          default:
            logger.warn("[ClientMessage] Unknown message type:", type);
        }
      }
    } catch (err) {
      logger.error("[ClientMessage] Error processing client message:", err);
    }
  });

  clientWs.on("close", async (code, reason) => {
    logger.warn(
      `[Connection] Client ${clientId} disconnected. code=${code}, reason=${
        reason || "<no reason>"
      }`
    );
    await cleanupConnection(clientId);
  });

  clientWs.on("error", async (err) => {
    logger.error(`[Connection] WebSocket error from client ${clientId}:`, err);
    await cleanupConnection(clientId);
  });
});

async function receiveFromGemini(clientWs, geminiConn, clientId) {
  logger.info(`[GeminiReceiver] Starting receive loop for client=${clientId}`);
  try {
    while (true) {
      if (clientWs.readyState !== 1) {
        logger.info(
          `[GeminiReceiver] Client ${clientId} is closed, stopping Gemini listener`
        );
        break;
      }

      let msg;
      try {
        msg = await geminiConn.receive();
      } catch (err) {
        logger.error(
          `[GeminiReceiver] Error receiving from Gemini for client=${clientId}:`,
          err
        );
        break;
      }

      if (!msg) {
        logger.info(
          `[GeminiReceiver] No more messages from Gemini for client=${clientId}`
        );
        break;
      }

      let response;
      try {
        response = JSON.parse(msg);
      } catch (err) {
        logger.error("[GeminiReceiver] Failed to parse Gemini response:", err);
        continue;
      }

      // 1) If there's a tool call, handle it
      if (response.toolCall && Array.isArray(response.toolCall.functionCalls)) {
        for (const fc of response.toolCall.functionCalls) {
          await handleToolCall(fc, clientWs, geminiConn, clientId);
        }
      }

      // 2) Attempt to forward relevant data (model's TTS or text) to the client
      try {
        const { serverContent } = response;
        const responseAsText = JSON.stringify(response);

        // If there's an interruption, handle it first before other messages
        if (response.interrupted || serverContent?.interrupted) {
          logger.info(`[GeminiReceiver] Interrupted for client=${clientId}`);
          await sendJsonSafe(clientWs, {
            type: "serverContent",
            serverContent: {
              interrupted: true,
              turnComplete: true, // Force turn complete on interruption
            },
          });
          // Send an end message to Gemini to ensure clean state
          await geminiConn.sendEnd();
          // Send an explicit turn_complete to ensure client state resets
          await sendJsonSafe(clientWs, {
            type: "turn_complete",
            data: true,
          });
          continue; // Skip processing other parts of this message
        }

        // Handle audio/text content from Gemini
        if (serverContent?.modelTurn) {
          // First, notify client that we're starting a new turn if we have content
          if (!response.turnComplete) {
            await sendJsonSafe(clientWs, {
              type: "serverContent",
              serverContent: { turnComplete: false },
            });
          }

          const { parts } = serverContent.modelTurn;
          if (Array.isArray(parts)) {
            for (const p of parts) {
              if (clientWs.readyState !== 1) break;

              // Plain text from Gemini
              if (p.text) {
                logger.info(
                  `[GeminiReceiver] Forwarding text data to client=${clientId}:`,
                  p.text
                );
                await sendJsonSafe(clientWs, {
                  type: "text",
                  data: p.text.trim(),
                  turnComplete: !!serverContent.turnComplete,
                });
              }
              // Aquí iría el manejo de audio si estuviera habilitado
          }
        }
      } 

        // If the turn is finished, make sure client knows
        if (response.turnComplete || serverContent?.turnComplete) {
          logger.debug(`[GeminiReceiver] turnComplete for client=${clientId}`);
          await sendJsonSafe(clientWs, {
            type: "turn_complete",
            data: true,
          });
        }
      } catch (err) {
        logger.error(
          "[GeminiReceiver] Error forwarding message to client:",
          err
        );
      }
    }
  } catch (err) {
    logger.error(`[GeminiReceiver] Fatal error for client ${clientId}:`, err);
  } finally {
    logger.info(`[GeminiReceiver] Stopping for client ${clientId}`);
  }
}

async function handleToolCall(fc, clientWs, geminiConn, clientId) {
  try {
    const { id, name } = fc;
    logger.info(
      `[handleToolCall] Client=${clientId} => function name=${name}, args=`,
      fc.args
    );

    const toolHandler = toolHandlers[name];
    if (!toolHandler) {
      logger.warn(`[handleToolCall] Unrecognized tool: "${name}"`);
      // If unknown, respond with an error so the model can continue
      return await geminiConn._sendJson({
        tool_response: {
          function_responses: [
            {
              id,
              name,
              response: {
                rendered: true,
                state: "continue conversation",
                error: { message: `Tool not implemented: ${name}` },
              },
            },
          ],
        },
      });
    }

    // Call the recognized tool
    await toolHandler(fc, clientWs, geminiConn, clientId);
  } catch (err) {
    logger.error(`[handleToolCall] Error for client=${clientId}:`, err);
  }
}

async function cleanupConnection(clientId) {
  const conn = connections.get(clientId);
  if (!conn) {
    logger.info(`[Cleanup] No active connection for clientId=${clientId}`);
    return;
  }

  try {
    logger.info(`[Cleanup] Closing Gemini connection for clientId=${clientId}`);
    await conn.geminiConn.close();
    connections.delete(clientId);
  } catch (err) {
    logger.error("[Cleanup] Error closing Gemini connection:", err);
  }
}

const PORT = process.env.PORT || 8082;
server.listen(PORT, () => {
  logger.info(`[Startup] Server listening on port ${PORT}`);
});
