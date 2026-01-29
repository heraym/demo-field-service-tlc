"use client";

import configClient from "@/config_client";
import React, {
  useState,
  useRef,
  useEffect,
} from "react";
import { Mic, StopCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import { base64ToFloat32Array } from "@/lib/utils";


/**
 * Generates a random UUID (RFC4122).
 * @returns A string representing a UUID.
 */
function generateUUID(): string {
  let d = new Date().getTime();
  let d2 =
    (typeof performance !== "undefined" &&
      performance.now &&
      performance.now() * 1000) ||
    0;
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    let r = Math.random() * 16;
    if (d > 0) {
      r = (d + r) % 16 | 0;
      d = Math.floor(d / 16);
    } else {
      r = (d2 + r) % 16 | 0;
      d2 = Math.floor(d2 / 16);
    }
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Example: const DOMAIN = "localhost:8082";
const DOMAIN = configClient.BACKEND;
const WSS = DOMAIN.includes("localhost") ? "ws" : "wss";

interface ToolFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: {
      [key: string]: { type: string };
    };
    required: string[];
  };
}

interface Config {
  systemPrompt: string;
  googleSearch: boolean;
  allowInterruptions: boolean;
  tools: {
    function_declarations: ToolFunctionDeclaration[];
  }[];
}

/**
 * Simple enum for Gemini call state:
 * - Idle: Not connected or waiting
 * - Listening: The user is speaking, AI is listening
 * - Speaking: The AI is responding
 * - Interrupted: The AI was interrupted by a barge-in
 */
enum GeminiState {
  Idle = "Inactivo",
  Listening = "Escuchando",
  Speaking = "Hablando",
  Interrupted = "Interrumpido",
}

/**
 * This component manages a real-time audio (and optional video) call
 * with an AI assistant named "Ben". It sets up a WebSocket connection
 * and handles streaming audio to/from the server (Gemini).
 */
export default function GeminiVoiceChat() {
  // =========================================================================
  // States & Refs
  // =========================================================================

  // WebSocket connection states
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // AI readiness and errors
  const [geminiReady, setGeminiReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Displayed texts
  const [toolText, setToolText] = useState("");
  const [userTypingText, setUserTypingText] = useState("");
  const [conversationText, setConversationText] = useState("");
  const [assistantResponseText, setAssistantResponseText] = useState("");

  var contadorHistoria = 0;

  // Gemini call state
  const [geminiState, setGeminiState] = useState<GeminiState>(GeminiState.Idle);
  const geminiStateRef = useRef<GeminiState>(GeminiState.Idle);
  useEffect(() => {
    geminiStateRef.current = geminiState;
     
  }, [geminiState]);

  /**
   * Logs and updates the Gemini state, for debugging.
   * @param newState The new Gemini state to be set.
   */
  const setGeminiStateWithLog = (newState: GeminiState) => {
    console.log(`[GeminiState] ${geminiStateRef.current} -> ${newState}`);
    setGeminiState(newState);
  };

   

  

  // Config for the AI system
  const [config, setConfig] = useState<Config>({
    systemPrompt: configClient.SYSTEMPROMPT,
    googleSearch: false,
    allowInterruptions: true,
    tools: [
      {
        function_declarations: [
          {
            name: "write_text",
            description:
              "When you want to place some text in the UI explicitly. Use Line Breaks where appropriate to make it more readable.",
            parameters: {
              type: "object",
              properties: {
                text: { type: "string" },
              },
              required: ["text"],
            },
           
          }
        ],
      },
    ],
  });

  

  // WebSocket reference
  const wsRef = useRef<WebSocket | null>(null);

   
   

  // Unique client ID
  const clientId = useRef<string>(generateUUID());

  // Reflect geminiReady in a ref
  const geminiReadyRef = useRef(false);
  useEffect(() => {
    geminiReadyRef.current = geminiReady;
  }, [geminiReady]);

  // =========================================================================
  // Device Selections
  // =========================================================================
   
   

  const [cameraDevices, setCameraDevices] = useState<
    { deviceId: string; label: string }[]
  >([]);
  const [selectedCameraDeviceId, setSelectedCameraDeviceId] = useState<
    string | null
  >(null);

  

  // Video state
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [isDetectingDevices, setIsDetectingDevices] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
 

   
  // Keep track of the MediaStream and interval for video frames
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // =========================================================================
  // Enumerate Devices on Mount
  // =========================================================================
  useEffect(() => {
    setIsDetectingDevices(true);

    // First request permissions
    const requestPermissions = async () => {
      try {
        await navigator.mediaDevices
          .getUserMedia({ video: true })
          .then((stream) => {
            // Stop the stream immediately after getting permissions
            stream.getTracks().forEach((track) => track.stop());
          })
          .catch((err) => {
            console.warn("[Permissions] Video permission denied:", err);
            // Still try to get audio-only permissions
            return navigator.mediaDevices.getUserMedia({ audio: true });
          })
          .then((stream) => {
            if (stream) {
              stream.getTracks().forEach((track) => track.stop());
            }
          })
          .catch((err) => {
            console.error("[Permissions] Audio permission denied:", err);
            setError(
              "Please grant microphone permissions to use the voice chat."
            );
          });
      } catch (err: any) {
        console.error("[Permissions] Error:", err);
        setError("Media permissions are required: " + err.message);
      }
    };

    // Then enumerate devices
    const enumerateDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();

        

        // Cameras
        const videoInputs = devices.filter((d) => d.kind === "videoinput");
        const cams = videoInputs
          .filter((d) => d.deviceId !== "")
          .map((d: MediaDeviceInfo) => ({
            deviceId: d.deviceId,
            label: d.label || "Unnamed Camera",
          }));
        setCameraDevices(cams);

       
        
        if (cams.length > 0) {
          setSelectedCameraDeviceId(cams[0].deviceId);
        }

         
      } catch (err: any) {
        console.error("[enumerateDevices] Error:", err);
        setError("[enumerateDevices] " + err.message);
      }
    };

    // Execute both in sequence
    requestPermissions()
      .then(enumerateDevices)
      .finally(() => {
        setIsDetectingDevices(false);
      });

    // Set up device change listener
    navigator.mediaDevices.addEventListener("devicechange", enumerateDevices);
    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        enumerateDevices
      );
    };
  }, []);

  // Disable start button if no microphone
  const canStartCall = true;

  // =========================================================================
  // Start / Stop Call
  // =========================================================================

  /**
   * Initiates the voice call with the server by:
   * 1. Opening a WebSocket to the backend.
   * 2. Sending initial config.
   * 3. Starting the audio stream.
   */
  const startCall = async () => {
    try {

      setIsConnecting(true);

      // Prevent double connections
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING)
      ) {
        console.warn("[startCall] WebSocket already open/connecting");
        return;
      }

      // Create the WS URL: wss://DOMAIN/ws/CLIENT_ID
      wsRef.current = new WebSocket(
        `${WSS}://${DOMAIN}/ws/${clientId.current}`
      );

      wsRef.current.onopen = async () => {
        console.log("[WS:onopen] Sending initial config to server...");
        wsRef.current?.send(
          JSON.stringify({
            type: "config",
            config: config,
          })
        );

        setToolText("");
        // No iniciar el stream de audio, ya que no queremos manejar audio.
        // await startAudioStream();

        setIsStreaming(true);
        setGeminiReady(true);
        
      };

      wsRef.current.onmessage = (event) => {
        handleServerMessage(event);
      };

      wsRef.current.onerror = (evt: Event) => {
        console.error("[WS:onerror]", evt);
        setError("[WebSocket:onerror] Unknown error occurred.");
      };

      wsRef.current.onclose = (evt) => {
        console.warn("[WS:onclose]", evt.code, evt.reason);
        stopCall();
      };
    } catch (err: any) {
      console.error("[startCall] Error:", err);
      setError("[startCall] " + err.message);
    } finally {
      setIsConnecting(false);
    }
  };

  /**
   * Safely cleans up and terminates the call:
   * 1. Stops microphone input.
   * 2. Stops video (if any).
   * 3. Closes the AudioContext.
   * 4. Closes the WebSocket connection.
   * 5. Resets local state.
   */
  const stopCall = () => {
     
    // Stop video
    stopVideoStream();

    // Close WebSocket
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
      } catch (err) {
        console.error("[stopCall] Error closing WebSocket:", err);
      } finally {
        wsRef.current = null;
      }
    }

 

  

    // Clear texts
    setToolText("");
    setUserTypingText("");
    setConversationText("");
    setAssistantResponseText("");
    setError(null);

    // State resets
    setIsStreaming(false);
    setGeminiReady(false);
    setGeminiState(GeminiState.Idle);
  };

  // =========================================================================
  // Handle Incoming Messages from Server
  // =========================================================================

  /**
   * Handles WebSocket messages from the server. These messages can include:
   * - `gemini_ready`: indicates AI is ready.
   * - `audio`: TTS audio data.
   * - `text` or `tool_text`: text appended to conversation or tools output.
   * - `end_call`: signals the AI wants to end the call.
   * - `serverContent`: advanced usage with possible inline audio data chunks.
   * @param event The WebSocket message event.
   */
  const handleServerMessage = async (event: MessageEvent) => {
    try {
      let response;
      if (event.data instanceof Blob) {
        const text = await event.data.text();
        response = JSON.parse(text);
      } else {
        response = JSON.parse(event.data);
      }

      switch (response.type) {
        case "gemini_ready":
          setGeminiReady(true);
          setGeminiStateWithLog(GeminiState.Listening);
          break;

         

        case "text":
          // Append server text to the dedicated assistant response area
          contadorHistoria = contadorHistoria + 1;
          if (contadorHistoria < 5)
           { 
            setAssistantResponseText((prev) => prev + response.data); }
           else { 
            setAssistantResponseText(response.data);
            contadorHistoria = 0;
           }
           
          break;

        case "tool_text":
          setToolText("" + response.data);
          break;

        case "end_call":
          // AI requested to end the call
          setToolText("ENDING CALL: " + response.data);
          setTimeout(() => {
            stopCall();
          }, 5000); // 5 second delay
          break;
        
        case "turn_complete":
          // El backend ha finalizado su turno, volvemos a escuchar.
          setGeminiStateWithLog(GeminiState.Listening);
          break;

        case "cargar_ticket":
              // AI requested to end the call
              setToolText("Cargar Ticket: " + response.data);
              break;    

        case "serverContent":
          // Possibly advanced usage
          if (response.serverContent.interrupted) {
            handleInterruption();
            return;
          }

          if (response.serverContent.modelTurn?.parts?.[0]?.inlineData) {
            const textData =
              response.serverContent.modelTurn.parts[0].inlineData.data;
             
            // Audio playback is disabled as per user request.
            // if (geminiState !== GeminiState.Speaking) {
            //   setGeminiStateWithLog(GeminiState.Speaking);
            // }
            // enqueueAudio(base64ToFloat32Array(audioData));
          }

          if (response.serverContent.turnComplete) {
            setGeminiStateWithLog(GeminiState.Listening);
          }
          break;

        default:
          console.log("[WS:onmessage] Unhandled type:", response.type);
          break;
      }
    } catch (err) {
      console.error("[onmessage] parse error:", err);
    }
  };

  /**
   * Handles a barge-in scenario (user interrupting AI).
   */
  const handleInterruption = () => {
    console.warn("[handleInterruption] Barge-in detected");
    setGeminiStateWithLog(GeminiState.Interrupted);
  };

  // =========================================================================
  // Turn Management: continue or end
  // =========================================================================

  /**
   * Sends a "continue" signal to prompt the AI to continue sending TTS audio.
   */
  const sendContinueSignal = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const msg = {
      client_content: {
        turns: [{ role: "user", parts: [] }],
        turn_complete: false,
      },
    };
    wsRef.current.send(JSON.stringify({ type: "continue", data: msg }));
  };

  /**
   * Sends a "end" message to finalize the current user turn (text input).
   */
  const sendEndMessage = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const msg = {
      client_content: {
        turns: [{ role: "user", parts: [] }],
        turn_complete: true,
      },
    };
    wsRef.current.send(JSON.stringify({ type: "end", data: msg }));
  };

  /**
   * Sends the user's typed text to the backend.
   */
  const sendText = () => {
    if (
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN ||
      !userTypingText.trim()
    ) {
      return; // No enviar si no hay conexión o el texto está vacío
    }

    console.log(`[sendText] Sending: "${userTypingText}"`);
    wsRef.current.send(
      JSON.stringify({
        type: "text",
        data: userTypingText,
      })
    );
    setConversationText(`${conversationText}  User: ${userTypingText}`)
    setUserTypingText(""); // Limpiar el área de texto después de enviar
  };
    

    

  // =========================================================================
  // Video handling (optional)
  // =========================================================================

  // Enable or disable video feed when streaming toggles
  useEffect(() => {
    if (!isStreaming) {
      stopVideoStream();
      return;
    }
    if (videoEnabled) {
      startVideoStream();
    } else {
      stopVideoStream();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoEnabled]);

  // Restart video stream if camera device changes mid-call
  useEffect(() => {
    if (isStreaming && videoEnabled) {
      stopVideoStream();
      startVideoStream();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCameraDeviceId]);

  /**
   * Starts the video stream from the selected camera (if any) and sends frames.
   */
  const startVideoStream = async () => {
    try {
      stopVideoStream(); // Clear any existing
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.warn("[startVideoStream] WS not open yet");
        return;
      }

      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 320 },
          height: { ideal: 240 },
        },
      };
      if (selectedCameraDeviceId) {
        (constraints.video as MediaTrackConstraints).deviceId = {
          exact: selectedCameraDeviceId,
        };
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      videoStreamRef.current = stream;

      // Send frames every 1 second
      videoIntervalRef.current = setInterval(() => {
        captureAndSendFrame();
      }, 1000);
    } catch (err: any) {
      console.error("[startVideoStream] error:", err);
      setError("[startVideoStream] " + err.message);
      setVideoEnabled(false);
    }
  };

  /**
   * Stops the current video stream and interval.
   */
  const stopVideoStream = () => {
    if (videoStreamRef.current) {
      try {
        videoStreamRef.current.getTracks().forEach((track) => {
          track.stop();
          track.enabled = false;
        });
      } catch (err) {
        console.error("[stopVideoStream] Error stopping tracks:", err);
      }
      videoStreamRef.current = null;
    }
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
        videoRef.current.load();
      } catch (err) {
        console.error(
          "[stopVideoStream] Error cleaning up video element:",
          err
        );
      }
    }
  };

  /**
   * Captures the current video frame to a canvas, encodes as base64, and sends via WebSocket.
   */
  const captureAndSendFrame = () => {
    if (!geminiReadyRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!canvasRef.current || !videoRef.current) return;

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;
    ctx.drawImage(videoRef.current, 0, 0);
    const base64Image = canvasRef.current
      .toDataURL("image/jpeg", 0.8)
      .split(",")[1];

    wsRef.current.send(
      JSON.stringify({
        type: "image",
        data: base64Image,
      })
    );
  };

  

  // =========================================================================
  // Cleanup on Unmount
  // =========================================================================
  useEffect(() => {
    return () => {
      stopCall();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * @returns true if the selected camera device label contains "front".
   */
  const isFrontFacingCamera = () => {
    if (!selectedCameraDeviceId) return false;
    const selectedCamera = cameraDevices.find(
      (cam) => cam.deviceId === selectedCameraDeviceId
    );
    if (!selectedCamera) return false;
    return /front/i.test(selectedCamera.label);
  };

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <div className="container mx-auto py-8 px-4">
    

      {/* HEADLINE */}
      <div className="flex items-center justify-between">
        
        <div className="flex items-center gap-3">
          <img src="logo.png" alt="Telecentro Logo" className="h-10"/>
          <h1 className="text-3xl font-bold">Field Service</h1>
        </div>
        {!isStreaming ? (
          !isDetectingDevices ? (
            <Button
              onClick={startCall}
              variant="blue"
              size="lg"
              className="px-6 py-4 text-xl font-semibold"
              disabled={isConnecting || !canStartCall}
            >
              <Mic
                className={`mr-2 h-5 w-5 ${
                  isConnecting ? "animate-pulse" : ""
                }`}
              />
              {isConnecting ? "Connecting..." : "Iniciar"}
            </Button>
          ) : (
            <div className="text-gray-500 animate-pulse">
              Detecting Media...
            </div>
          )
        ) : (
          <Button
            onClick={stopCall}
            variant="destructive"
            size="lg"
            className="px-6 py-4 text-xl font-semibold"
          >
            <StopCircle className="mr-2 h-5 w-5" />
            Detener
          </Button>
        )}
      </div>

      {/* Quick Explanation */}
      <p className="mt-2 mb-4">
        Este chat de voz en tiempo real usa Gemini!
      </p>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* If in call, show mic indicator and text input */}
      {isStreaming && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center pt-6 mt-2 space-y-4">
            <Mic className="h-8 w-8 text-blue-500 animate-pulse" />
            <p className="text-gray-600">
              {geminiReady ? "Call Ongoing..." : "Waiting..."}
            </p>

            {/* GEMINI STATE INDICATOR */}
            <div className="mb-4">
              {geminiState === GeminiState.Listening && (
                <div className="text-green-600 font-semibold">
                  Gemini is listening...
                </div>
              )}
              {geminiState === GeminiState.Speaking && (
                <div className="text-blue-600 font-semibold">
                  Gemini is speaking...
                </div>
              )}
              {geminiState === GeminiState.Interrupted && (
                <div className="text-red-500 font-semibold">
                  Gemini was interrupted (barge-in)!
                </div>
              )}
            </div>

            {/* Input de texto para el usuario */}
            <div className="w-full px-4">
              <Label htmlFor="user-text-input" className="text-left w-full block mb-2">
                O escribe tu mensaje:
              </Label>
              <div className="flex gap-2">
                <Textarea
                  id="user-text-input"
                  placeholder="Escribe aquí..."
                  value={userTypingText}
                  onChange={(e) => setUserTypingText(e.target.value)}
                  className="flex-grow"
                />
                <Button onClick={sendText} disabled={!userTypingText.trim()}>
                  Enviar
                </Button>
              </div>
            </div>


          </CardContent>
        </Card>
      )}

      {/* Video feed if enabled */}
      {isStreaming && videoEnabled && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                width={320}
                height={240}
                className="w-full h-full object-contain"
                style={{
                  transform: isFrontFacingCamera() ? "scaleX(-1)" : "none",
                }}
              />
              <canvas
                ref={canvasRef}
                className="hidden"
                width={640}
                height={480}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tool Text */}
      {toolText && (
        <Card className="mt-4">
          <CardContent className="pt-4">
            <h2 className="font-semibold mb-2">Etiquetas</h2>
            <pre className="whitespace-pre-wrap">{toolText}</pre>
          </CardContent>
        </Card>
      )}
      {/* Assistant Response Text */}
      {assistantResponseText && (
        <Card className="mt-4">
          <CardContent className="pt-4">
            <h2 className="font-semibold mb-2">Respuesta del Asistente</h2>
            <pre className="whitespace-pre-wrap text-gray-800 bg-gray-50 p-3 rounded-md">
              {assistantResponseText}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Conversation */}
      {conversationText && (
        <Card className="mt-4">
          <CardContent className="pt-4">
            <h2 className="font-semibold mb-2">Conversation</h2>
            <pre className="whitespace-pre-wrap text-gray-700">
              {conversationText}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Media Selection Card */}
      <Card className="mt-6">
        <CardContent className="pt-6 space-y-4">
          <h2 className="text-xl font-semibold">Seleccion de Media</h2>

          {isDetectingDevices ? (
            <div className="text-gray-500 animate-pulse">
              Detectando Media...
            </div>
          ) : (
            <>
               

              {/* Camera + Video Toggle */}
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <Label htmlFor="camera-select">Camara</Label>
                  <Select
                    value={selectedCameraDeviceId || ""}
                    onValueChange={(val) => setSelectedCameraDeviceId(val)}
                    disabled={!cameraDevices.length}
                  >
                    <SelectTrigger id="camera-select">
                      <SelectValue placeholder="Select camera" />
                    </SelectTrigger>
                    <SelectContent>
                      {cameraDevices.map((cam) => (
                        <SelectItem key={cam.deviceId} value={cam.deviceId}>
                          {cam.label || cam.deviceId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="enable-video"
                    checked={videoEnabled}
                    onCheckedChange={(checked) =>
                      setVideoEnabled(Boolean(checked))
                    }
                    disabled={!isStreaming}
                  />
                  <Label htmlFor="enable-video">Habilitar Video</Label>
                </div>
              </div>
               
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
