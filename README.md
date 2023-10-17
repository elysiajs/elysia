<br>
<p align=center>
  <img width=480 src=https://user-images.githubusercontent.com/35027979/205498891-b75dc404-3232-4929-b216-823aa7373b71.png alt='Elysia label' />
</p>

<p align=center>Ergonomic Framework for Humans</p>

<p align=center>
    <a href=https://elysiajs.com>Documentation</a> | <a href=https://discord.gg/eaFJ2KDJck>Discord</a>
</p>

## Philosophies
Building on top of 3 philosophies:

- Performance
    - You shall not worry about the underlying performance
- Simplicity
    - Simple building blocks to create an abstraction, not repeating yourself
- Flexibility
    - You shall be able to customize most of the library to fit your needs

Designed with TypeScript in mind, you don't need to understand TypeScript to gain the benefit of TypeScript with Elysia. The library understands what you want and automatically infers the type from your code.

⚡️ Elysia is [one of the fastest Bun web frameworks](https://github.com/SaltyAom/bun-http-framework-benchmark)

## Documentation
The documentation is available on [elysiajs.com](https://elysiajs.com).

## Integrating Socket.IO with Elysia.
Certainly, I can provide an example of how to document the integration process between Socket.IO and Elysia. Here's a template for creating a clear and detailed documentation section for this integration:

## **. Document the Integration Process:**

   To integrate Socket.IO with Elysia, follow these steps. This integration allows real-time communication between your Elysia application and clients through WebSockets. 

   **Prerequisites:**
   - Ensure you have Node.js and npm installed.

   **1. Install Socket.IO:**
   - First, install the Socket.IO library using npm in your project directory:

     ```bash
     npm install socket.io
     ```

   **2. Create a Socket.IO Server:**
   - Set up a Socket.IO server in your Elysia application code. Here's an example using Express:

     ```javascript
     const http = require('http');
     const express = require('express');
     const socketIO = require('socket.io');
     
     const app = express();
     const server = http.createServer(app);
     const io = socketIO(server);

     server.listen(3000, () => {
       console.log('Socket.IO server listening on port 3000');
     });
     ```

   **3. Connect Elysia to Socket.IO:**
   - In your Elysia application, establish a connection to the Socket.IO server. This is usually done in a relevant Elysia module or component. Here's an example:

     ```javascript
     const socket = require('socket.io-client')('http://localhost:3000');

     // Handle incoming events
     socket.on('event-name', (data) => {
       console.log('Received data:', data);
       // Process data as needed
     });

     // Emit events
     socket.emit('event-name', { message: 'Hello, Socket.IO!' });
     ```

   **4. Event Handling:**
   - Define event handlers in your Elysia application to process data sent via Socket.IO. Customize these handlers according to your application's requirements.

   **5. Error Handling and Best Practices:**
   - Implement error handling, security measures, and best practices when working with Socket.IO. Ensure that you handle disconnections and errors gracefully.

   **6. Test the Integration:**
   - Before deploying your application, thoroughly test the Socket.IO integration to ensure it functions as expected. Verify real-time communication and data exchange between your Elysia application and clients.

   **7. Update the Plugin (if applicable):**
   - If your Elysia plugin or module requires updates to support the Socket.IO integration, make the necessary adjustments.

   Congratulations! You've successfully integrated Socket.IO with your Elysia application, enabling real-time communication with clients.

   This documentation provides developers with a clear, step-by-step guide on how to integrate Socket.IO with Elysia, including prerequisites, code examples, and best practices.

## Contributing
See [Contributing Guide](CONTRIBUTING.md) and please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Discord
Come join the [Discord channel~](https://discord.gg/eaFJ2KDJck)
