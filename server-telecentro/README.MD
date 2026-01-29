# AI Server - Telecentro Field Service

Este es el servidor backend para la aplicación Field Service. Actúa como un proxy de WebSocket entre el frontend del cliente y la API de Google Gemini, permitiendo una comunicación de IA en tiempo real.

## Características

- **Proxy de WebSocket:** Gestiona las conexiones de WebSocket de los clientes y las conecta a la API de Gemini.
- **Gestión de la comunicación:** Transmite mensajes de texto e imágenes del cliente a Gemini.
- **Manejo de herramientas de IA:** Implementa lógica del lado del servidor para las llamadas a funciones (herramientas) solicitadas por el modelo Gemini.
- **Configuración dinámica:** Acepta la configuración del cliente (por ejemplo, el aviso del sistema) al iniciar la conexión.
- **Registro:** Utiliza Pino para un registro estructurado y legible.

## Pila de tecnología

- **Entorno de ejecución:** Node.js
- **Framework:** Express.js
- **WebSockets:** `ws`
- **Variables de entorno:** `dotenv`
- **Registro:** `pino`

## Empezando

Sigue estos pasos para poner en marcha el servidor.

### Prerrequisitos

- Node.js (versión 20 o superior)
- npm
- Una clave API de Google Gemini

### Instalación

1. Clona el repositorio:
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   ```
2. Navega al directorio del proyecto:
   ```bash
   cd demo-field-service-tlc/server-telecentro
   ```
3. Instala las dependencias:
   ```bash
   npm install
   ```
4. Crea un archivo `.env` en la raíz del directorio `server-telecentro` y añade tu clave API de Gemini:
   ```
   GEMINI_API_KEY=tu_clave_api_aqui
   ```

### Ejecutando el servidor

Para iniciar el servidor, ejecuta:

```bash
npm start
```

El servidor se iniciará en el puerto `8082` por defecto.

## Flujo de trabajo de la aplicación

1.  El servidor se inicia y escucha las conexiones de WebSocket en la ruta `/ws/:clientId`.
2.  Un cliente (por ejemplo, la aplicación `front-telecentro`) se conecta, proporcionando un ID de cliente único.
3.  El cliente debe enviar un primer mensaje de tipo `config` que contenga el `systemPrompt` y cualquier definición de herramienta.
4.  El servidor utiliza esta configuración para establecer una conexión de WebSocket con el backend de la API de Gemini.
5.  Una vez que la conexión con Gemini tiene éxito, el servidor envía un mensaje `gemini_ready` al cliente.
6.  A partir de este momento, el servidor transmite los mensajes entre el cliente y Gemini:
    -   Los mensajes de texto e imágenes del cliente se envían a Gemini.
    -   Las respuestas de texto y las solicitudes de llamada a función de Gemini se procesan y se envían al cliente.

## Manejo de herramientas

El archivo `functions.js` define los manejadores para las herramientas que el modelo de IA puede invocar:

-   **`write_text`**: Se activa cuando el modelo de IA quiere mostrar texto explícitamente en la interfaz de usuario del cliente. El servidor envía este texto al cliente a través de un mensaje `tool_text`.
-   **`end_call`**: Se activa cuando el modelo de IA decide que la conversación debe terminar. El servidor notifica al cliente con un mensaje `end_call`.
