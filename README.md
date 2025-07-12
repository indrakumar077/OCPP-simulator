# OCPP 1.6J Charging Point Simulator

A complete OCPP 1.6J charging point simulator with React frontend and Node.js backend for testing and development purposes.

## Features

- **React Frontend**: Modern, responsive UI for device configuration and status control
- **Node.js Backend**: Express server with WebSocket OCPP client
- **OCPP 1.6J Protocol**: Full implementation of OCPP 1.6J over WebSocket
- **Real-time Status Control**: Change charging point status from the frontend
- **Heartbeat Management**: Automatic 30-second heartbeat intervals
- **Activity Logging**: Real-time logs of all OCPP messages and actions
- **Device Configuration**: Configure device ID, connector, power, and type

## OCPP Features Implemented

- ✅ **BootNotification**: Sent on connection
- ✅ **Heartbeat**: Automatic 30-second intervals
- ✅ **StatusNotification**: Changeable from frontend
- ✅ **WebSocket Connection**: OCPP 1.6J protocol
- ✅ **Message Handling**: Proper OCPP message format and responses

## Quick Start

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Installation

1. **Install backend dependencies:**
   ```bash
   npm install
   ```

2. **Install frontend dependencies:**
   ```bash
   cd client
   npm install
   cd ..
   ```

### Running the Application

#### Option 1: Run Both Frontend and Backend (Recommended)
```bash
npm run dev:full
```

#### Option 2: Run Separately

**Backend (Terminal 1):**
```bash
npm run dev
```

**Frontend (Terminal 2):**
```bash
npm run client
```

The application will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001

## Usage

### 1. Configure Device
1. Enter your **Device ID** (required for connection)
2. Set **Connector ID** (default: 1)
3. Configure **Power** in kW (default: 22)
4. Select **Type** (AC or DC)
5. Click "Configure Device"

### 2. Connect to OCPP Server
1. Click "Connect" to establish WebSocket connection
2. The simulator will connect to: `ws://test.1charging.com/ws/ocpp/16/{DEVICE_ID}`
3. **BootNotification** will be sent automatically
4. **Heartbeat** will start every 30 seconds

### 3. Control Status
Once connected, you can change the charging point status:
- **Available**: Ready for charging
- **Occupied**: Vehicle connected but not charging
- **Reserved**: Reserved for specific user
- **Unavailable**: Out of service
- **Faulted**: Error condition
- **Finishing**: Charging session ending
- **Preparing**: Preparing to charge
- **Charging**: Actively charging

### 4. Monitor Activity
- View real-time logs of all OCPP messages
- See connection status and device configuration
- Monitor heartbeat and status notifications

## API Endpoints

### Backend API (Port 3001)

- `GET /api/status` - Get current connection status and device config
- `POST /api/configure` - Update device configuration
- `POST /api/connect` - Connect to OCPP server
- `POST /api/disconnect` - Disconnect from OCPP server
- `POST /api/status-notification` - Send status notification

## OCPP Message Format

The simulator follows OCPP 1.6J message format:

```json
[2, "unique-message-id", {
  "action": "Heartbeat",
  "timestamp": "2023-01-01T00:00:00Z"
}]
```

### Message Types
- **2**: CALL (request)
- **3**: CALLRESULT (response)
- **4**: CALLERROR (error)

### Supported Actions
- `BootNotification`
- `Heartbeat`
- `StatusNotification`
- `Authorize` (responds with NotImplemented)
- `StartTransaction` (responds with NotImplemented)
- `StopTransaction` (responds with NotImplemented)

## Project Structure

```
ocpp-simulator/
├── server.js              # Node.js backend with OCPP WebSocket client
├── package.json           # Backend dependencies
├── client/                # React frontend
│   ├── src/
│   │   ├── App.js         # Main React component
│   │   ├── App.css        # Styling
│   │   ├── index.js       # React entry point
│   │   └── index.css      # Base styles
│   ├── public/
│   │   └── index.html     # HTML template
│   └── package.json       # Frontend dependencies
└── README.md              # This file
```

## Configuration

### Device Configuration
- **Device ID**: Unique identifier for the charging point
- **Connector ID**: Physical connector number (default: 1)
- **Power**: Maximum power in kW (default: 22)
- **Type**: AC or DC charging (default: AC)

### OCPP Server URL
The simulator connects to: `ws://test.1charging.com/ws/ocpp/16/{DEVICE_ID}`

To change the server URL, modify the `wsUrl` in `server.js`:

```javascript
const wsUrl = `ws://your-ocpp-server.com/ws/ocpp/16/${deviceConfig.deviceId}`;
```

## Development

### Adding New OCPP Messages

1. Add the action to the `ACTIONS` object in `server.js`
2. Implement the message handler in `sendOCPPMessage()`
3. Add response handling in `handleIncomingCall()`

### Customizing the UI

The React frontend is in `client/src/App.js`. You can:
- Add new configuration fields
- Create additional status controls
- Modify the styling in `App.css`

## Troubleshooting

### Connection Issues
- Ensure the OCPP server is running and accessible
- Check that the Device ID is properly configured
- Verify network connectivity to the OCPP server

### WebSocket Errors
- Check browser console for WebSocket connection errors
- Verify the OCPP server supports OCPP 1.6J protocol
- Ensure the server accepts the `ocpp1.6` sub-protocol

### Frontend Issues
- Clear browser cache if UI doesn't update
- Check browser console for JavaScript errors
- Verify the backend API is running on port 3001

## License

MIT License - feel free to use and modify for your OCPP testing needs.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review the OCPP 1.6 specification
3. Check the browser console and server logs
4. Create an issue with detailed error information 