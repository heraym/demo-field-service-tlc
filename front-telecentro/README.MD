# Field Service - Gemini Playground

Esta es una aplicación de front-end construida con Next.js que proporciona una interfaz de chat de voz y texto en tiempo real para interactuar con un asistente de IA impulsado por Gemini.

## Características

- **Chat en tiempo real:** Interactúa con el asistente de IA a través de voz o texto.
- **Transmisión de video:** Transmite video opcionalmente desde la cámara del usuario.
- **Selección de dispositivos:** Permite al usuario elegir su cámara preferida.
- **Indicadores de estado:** Muestra el estado actual del asistente de IA (Inactivo, Escuchando, Hablando).
- **Interfaz personalizable:** La configuración, como el aviso del sistema, se puede ajustar.

## Pila de tecnología

- **Framework:** Next.js (con Turbopack)
- **Lenguaje:** TypeScript
- **Estilo:** Tailwind CSS
- **Componentes de UI:** Radix UI
- **Iconos:** Lucide Icons

## Empezando

Sigue estos pasos para poner en marcha el entorno de desarrollo.

### Prerrequisitos

- Node.js (versión 20 o superior)
- npm

### Instalación

1. Clona el repositorio:
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   ```
2. Navega al directorio del proyecto:
   ```bash
   cd demo-field-service-tlc/front-telecentro
   ```
3. Instala las dependencias:
   ```bash
   npm install
   ```

### Ejecutando la aplicación

Para iniciar el servidor de desarrollo, ejecuta:

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador para ver la aplicación.

## Scripts de compilación

- `npm run dev`: Inicia el servidor de desarrollo con Turbopack.
- `npm run build`: Crea la aplicación para producción.
- `npm run start`: Inicia un servidor de producción.
- `npm run lint`: Ejecuta el linter para identificar y corregir problemas de código.
