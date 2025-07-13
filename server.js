const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Multiple charging points support with individual connections
let chargingPoints = {
  // Example structure:
  // "CP001": {
  //   deviceId: "CP001",
  //   connectors: {
  //     1: { id: 1, status: "Available", power: 22, type: "AC" },
  //     2: { id: 2, status: "Available", power: 22, type: "AC" }
  //   }
  // }
};

// Individual WebSocket connections for each charging point
let chargingPointConnections = {
  // Example structure:
  // "CP001": {
  //   webSocket: WebSocket,
  //   isConnected: false,
  //   heartbeatInterval: null,
  //   pendingStartTransaction: null
  // }
};

let selectedChargingPoint = null;
let selectedConnector = null;

// OCPP Messages tracking
let ocppMessages = [];

// Track pending StartTransaction requests
let pendingStartTransaction = null;

// OCPP Message Types
const MESSAGE_TYPES = {
  CALL: 2,
  CALLRESULT: 3,
  CALLERROR: 4
};

// OCPP Message Actions
const ACTIONS = {
  BOOT_NOTIFICATION: 'BootNotification',
  HEARTBEAT: 'Heartbeat',
  STATUS_NOTIFICATION: 'StatusNotification',
  AUTHORIZE: 'Authorize',
  START_TRANSACTION: 'StartTransaction',
  STOP_TRANSACTION: 'StopTransaction',
  METER_VALUES: 'MeterValues'
};

// Status values for StatusNotification
const STATUS_VALUES = {
  Available: 'Available',
  Occupied: 'Occupied',
  Reserved: 'Reserved',
  Unavailable: 'Unavailable',
  Faulted: 'Faulted',
  Finishing: 'Finishing',
  Preparing: 'Preparing',
  Charging: 'Charging'
};

// Add transaction info to each connector
// Example: chargingPoints[deviceId].connectors[connectorId].transaction = { transactionId, meterStart, timestamp }

// Simulate meter value generator
function getRandomMeterValue() {
  // Generate a realistic starting meter value between 1000-5000 Wh
  return Math.floor(Math.random() * 4000) + 1000;
}

// Connect to OCPP server for a specific charging point
function connectToOCPP(deviceId) {
  console.log(`Attempting to connect to OCPP server for: ${deviceId}`);
  
  if (!deviceId) {
    console.log('No device ID provided - cannot connect to OCPP server');
    return;
  }

  // Close existing connection if any
  if (chargingPointConnections[deviceId]) {
    console.log(`Closing existing connection for ${deviceId}`);
    if (chargingPointConnections[deviceId].webSocket) {
      chargingPointConnections[deviceId].webSocket.close();
    }
    if (chargingPointConnections[deviceId].heartbeatInterval) {
      clearInterval(chargingPointConnections[deviceId].heartbeatInterval);
    }
  }

  const wsUrl = `${config.ocppServerUrl}${deviceId}`;
  console.log(`Connecting to OCPP server: ${wsUrl}`);

  const webSocket = new WebSocket(wsUrl, ['ocpp1.6']);

  // Initialize connection object
  chargingPointConnections[deviceId] = {
    webSocket: webSocket,
    isConnected: false,
    heartbeatInterval: null,
    pendingStartTransaction: null
  };

  webSocket.on('open', () => {
    console.log(`Connected to OCPP server for ${deviceId}`);
    chargingPointConnections[deviceId].isConnected = true;
    
    // Send BootNotification immediately after connection
    sendBootNotification(deviceId);

    // Send StatusNotification(Available) for each connector
    const connectors = chargingPoints[deviceId]?.connectors || {};
    Object.keys(connectors).forEach(connectorId => {
      sendStatusNotification('Available', deviceId, parseInt(connectorId));
    });

    // Start heartbeat
    startHeartbeat(deviceId);
  });

  webSocket.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleOCPPMessage(message, deviceId);
      
      // Track received message
      addOCPPMessage('received', message, deviceId);
    } catch (error) {
      console.error('Error parsing OCPP message:', error);
    }
  });

  webSocket.on('error', (error) => {
    console.error(`WebSocket error for ${deviceId}:`, error);
    chargingPointConnections[deviceId].isConnected = false;
  });

  webSocket.on('close', () => {
    console.log(`Disconnected from OCPP server for ${deviceId}`);
    if (chargingPointConnections[deviceId]) {
      chargingPointConnections[deviceId].isConnected = false;
      stopHeartbeat(deviceId);
    }
  });
}

// Add message to tracking
function addOCPPMessage(direction, message, deviceId = null, timestamp = new Date()) {
  const messageEntry = {
    id: Date.now() + Math.random(),
    direction: direction, // 'sent' or 'received'
    message: message,
    timestamp: timestamp,
    deviceId: deviceId, // Track which charging point sent/received
    action: typeof message[2] === 'string' ? message[2] : (message[2]?.action || 'Unknown')
  };
  
  ocppMessages.unshift(messageEntry); // Add to beginning
  
  // Keep only last 100 messages
  if (ocppMessages.length > 100) {
    ocppMessages = ocppMessages.slice(0, 100);
  }
}

// Send OCPP message for a specific charging point
function sendOCPPMessage(action, payload = {}, deviceId = null) {
  if (!deviceId) {
    console.log('No device ID provided - cannot send OCPP message');
    return;
  }

  const connection = chargingPointConnections[deviceId];
  if (!connection) {
    console.log(`No connection found for ${deviceId} - cannot send OCPP message`);
    return;
  }

  console.log(`Attempting to send OCPP message: ${action} for ${deviceId}`);
  console.log(`WebSocket exists: ${!!connection.webSocket}`);
  console.log(`Is connected: ${connection.isConnected}`);
  
  if (!connection.webSocket || !connection.isConnected) {
    console.log(`Not connected to OCPP server for ${deviceId} - message not sent`);
    return;
  }

  const messageId = uuidv4();
  const message = [
    MESSAGE_TYPES.CALL,
    messageId,
    action,
    payload || {}
  ];

  console.log(`Sending OCPP message: ${action} for ${deviceId}`, payload);
  console.log(`Message JSON:`, JSON.stringify(message));
  connection.webSocket.send(JSON.stringify(message));
  
  // Track sent message
  addOCPPMessage('sent', message, deviceId);

  // If StartTransaction, track for response
  if (action === 'StartTransaction') {
    connection.pendingStartTransaction = {
      messageId,
      deviceId: deviceId,
      connectorId: payload.connectorId
    };
  }
}

// Send BootNotification for a specific charging point
function sendBootNotification(deviceId) {
  const payload = {
    chargePointVendor: 'OCPP Simulator',
    chargePointModel: 'Simulator v1.0',
    chargePointSerialNumber: deviceId,
    chargeBoxSerialNumber: deviceId,
    firmwareVersion: '1.0.0',
    iccid: '',
    imsi: '',
    meterType: 'Simulated Meter',
    meterSerialNumber: `METER_${deviceId}`
  };

  sendOCPPMessage(ACTIONS.BOOT_NOTIFICATION, payload, deviceId);
}

// Send Heartbeat for a specific charging point
function sendHeartbeat(deviceId) {
  sendOCPPMessage(ACTIONS.HEARTBEAT, {}, deviceId);
}

// Send StatusNotification for a specific charging point
function sendStatusNotification(status, deviceId = null, connectorId = null, errorCode = null) {
  if (!deviceId || !connectorId) {
    console.log('Device ID or connector ID not provided');
    return;
  }

  const payload = {
    connectorId: connectorId,
    errorCode: errorCode,
    status: status,
    timestamp: new Date().toISOString(),
    info: `Simulated status: ${status}`
  };

  // Only send OCPP message if connected
  const connection = chargingPointConnections[deviceId];
  if (connection && connection.isConnected) {
    sendOCPPMessage(ACTIONS.STATUS_NOTIFICATION, payload, deviceId);
  } else {
    console.log(`Not connected to OCPP server for ${deviceId}, status change is local only`);
  }
}

// Track MeterValues intervals per connector
let meterValuesIntervals = {};

// Helper to start MeterValues sending
function startMeterValues(deviceId, connectorId) {
  // Clear any existing interval
  const key = `${deviceId}_${connectorId}`;
  if (meterValuesIntervals[key]) {
    clearInterval(meterValuesIntervals[key]);
  }
  const connector = chargingPoints[deviceId]?.connectors[connectorId];
  if (!connector || !connector.transaction) {
    console.log('Cannot start MeterValues: no connector or transaction found');
    return;
  }
  
  // Initialize meter value tracking
  let currentMeterValue = connector.transaction.meterStart;
  const power = connector.power || 22; // kW
  const isDC = connector.type === 'DC';
  
  // Calculate increment per interval: (power kW) * (intervalSeconds / 3600) * 1000 (Wh)
  const intervalSeconds = 30;
  const incrementPerInterval = (power * intervalSeconds) / 3600 * 1000; // Wh per interval
  
  // Initialize SOC tracking for DC chargers
  let currentSOC = 20; // Start from 20% (more realistic)
  const sessionStartTime = new Date(connector.transaction.timestamp).getTime();

  console.log(`Starting MeterValues for ${deviceId}:${connectorId}`);
  console.log(`Initial meter value: ${currentMeterValue} Wh`);
  console.log(`Power: ${power} kW, Type: ${connector.type}`);
  console.log(`Increment per ${intervalSeconds}s: ${incrementPerInterval} Wh`);

  meterValuesIntervals[key] = setInterval(() => {
    // Only send if status is Charging and transaction is active
    if (connector.status !== 'Charging' || !connector.transaction || !connector.transaction.transactionId) {
      console.log(`Stopping MeterValues for ${deviceId}:${connectorId} - status: ${connector.status}, transaction: ${connector.transaction?.transactionId}`);
      clearInterval(meterValuesIntervals[key]);
      return;
    }
    
    // Increment meter value
    currentMeterValue += incrementPerInterval;
    connector.transaction.lastMeterValue = currentMeterValue;
    
    // Calculate session duration for SOC
    const sessionDuration = (Date.now() - sessionStartTime) / 1000; // seconds
    if (isDC) {
      // For DC: SOC increases based on energy consumed
      const energyConsumed = (currentMeterValue - connector.transaction.meterStart) / 1000; // kWh
      const socIncrease = (energyConsumed / 50) * 100; // Assume 50 kWh battery capacity
      currentSOC = Math.min(95, 20 + socIncrease); // Start from 20% and increase
    }
    
    // Generate meter values in exact OCPP 1.6J format
    const timestamp = new Date().toISOString();
    const sampledValues = [];
    
    // SOC (State of Charge) - Only for DC chargers
    if (isDC) {
      sampledValues.push({
        value: currentSOC.toFixed(0), // Integer value
        measurand: 'SoC',
        unit: 'Percent',
        context: 'Sample.Periodic',
        location: 'EV'
      });
    }
    
    // Energy.Active.Import.Register (Wh) - Required - INCREMENTAL
    sampledValues.push({
      value: Math.round(currentMeterValue).toString(), // Wh value
      measurand: 'Energy.Active.Import.Register',
      unit: 'Wh'
    });
    
    // Voltage (V) - Single value
    const voltage = isDC ? 400 : 230;
    sampledValues.push({
      value: voltage.toString(),
      measurand: 'Voltage',
      unit: 'V'
    });
    
    // Current.Import (A) - Single value
    const currentValue = Math.round((power * 1000) / voltage); // Calculate current based on power and voltage
    sampledValues.push({
      value: currentValue.toString(),
      measurand: 'Current.Import',
      unit: 'A'
    });
    
    // Send MeterValues
    const payload = {
      connectorId: parseInt(connectorId),
      transactionId: connector.transaction.transactionId,
      meterValue: [
        {
          timestamp: timestamp,
          sampledValue: sampledValues
        }
      ]
    };
    console.log(`Sending MeterValues for ${deviceId}:${connectorId}`);
    console.log(`Current meter value: ${currentMeterValue} Wh`);
    console.log(`SOC: ${currentSOC.toFixed(0)}%`);
    console.log(`Sampled values: ${sampledValues.length}`);
    console.log(`MeterValues payload:`, JSON.stringify(payload, null, 2));
    sendOCPPMessage('MeterValues', payload, deviceId);
  }, intervalSeconds * 1000); // Send every 30 seconds
}

// Helper to stop MeterValues
function stopMeterValues(deviceId, connectorId) {
  const key = `${deviceId}_${connectorId}`;
  if (meterValuesIntervals[key]) {
    clearInterval(meterValuesIntervals[key]);
    delete meterValuesIntervals[key];
  }
}

// Update handleOCPPMessage to trigger Charging and MeterValues after StartTransaction
function handleOCPPMessage(message, deviceId) {
  console.log(`Received OCPP message for ${deviceId}:`, message);

  if (message.length < 3) {
    console.error('Invalid message format');
    return;
  }

  const [messageType, messageId, actionOrPayload, payloadMaybe] = message;
  const connection = chargingPointConnections[deviceId];

  switch (messageType) {
    case MESSAGE_TYPES.CALLRESULT:
      // If this is a StartTransaction response, save transactionId
      if (connection && connection.pendingStartTransaction && messageId === connection.pendingStartTransaction.messageId) {
        const payload = actionOrPayload;
        const { transactionId } = payload;
        // Save transactionId in connector state
        if (connection.pendingStartTransaction.deviceId && connection.pendingStartTransaction.connectorId) {
          const conn = chargingPoints[connection.pendingStartTransaction.deviceId].connectors[connection.pendingStartTransaction.connectorId];
          if (conn && conn.transaction) {
            conn.transaction.transactionId = transactionId;
            console.log(`Transaction started: ${transactionId} for ${connection.pendingStartTransaction.deviceId}:${connection.pendingStartTransaction.connectorId}`);
            // Set status to Charging and send StatusNotification
            conn.status = 'Charging';
            console.log(`Status changed to Charging for ${connection.pendingStartTransaction.deviceId}:${connection.pendingStartTransaction.connectorId}`);
            sendStatusNotification('Charging', connection.pendingStartTransaction.deviceId, connection.pendingStartTransaction.connectorId);
            // Start MeterValues
            startMeterValues(connection.pendingStartTransaction.deviceId, connection.pendingStartTransaction.connectorId);
          }
        }
        connection.pendingStartTransaction = null;
      }
      console.log(`Received response for message ${messageId}:`, actionOrPayload);
      break;
    case MESSAGE_TYPES.CALLERROR:
      console.error(`Received error for message ${messageId}:`, actionOrPayload);
      break;
    case MESSAGE_TYPES.CALL:
      // OCPP 1.6J: [2, id, action, payload]
      const action = typeof actionOrPayload === 'string' ? actionOrPayload : (actionOrPayload?.action || 'Unknown');
      const payload = typeof actionOrPayload === 'string' ? payloadMaybe : actionOrPayload;
      if (action) {
        handleIncomingCall(action, payload, messageId, deviceId);
      }
      break;
    default:
      console.log('Unknown message type:', messageType);
  }
}

// Handle incoming calls from server
function handleIncomingCall(action, payload, messageId, deviceId) {
  console.log(`Handling incoming call for ${deviceId}: ${action}`);

  const connection = chargingPointConnections[deviceId];
  if (!connection || !connection.webSocket) {
    console.log(`No connection found for ${deviceId} - cannot respond`);
    return;
  }

  switch (action) {
    case ACTIONS.HEARTBEAT:
      // Respond to heartbeat request
      const response = [MESSAGE_TYPES.CALLRESULT, messageId, { currentTime: new Date().toISOString() }];
      connection.webSocket.send(JSON.stringify(response));
      break;

    case ACTIONS.BOOT_NOTIFICATION:
      // Respond to boot notification request
      const bootResponse = [MESSAGE_TYPES.CALLRESULT, messageId, {
        status: 'Accepted',
        currentTime: new Date().toISOString(),
        interval: 30
      }];
      connection.webSocket.send(JSON.stringify(bootResponse));
      break;

    case 'RemoteStartTransaction':
      // Accept the remote start
      const remoteStartResponse = [MESSAGE_TYPES.CALLRESULT, messageId, { status: 'Accepted' }];
      connection.webSocket.send(JSON.stringify(remoteStartResponse));
      // Simulate starting a transaction
      simulateStartTransaction(payload, deviceId);
      break;

    case 'RemoteStopTransaction':
      // Accept the remote stop
      const remoteStopResponse = [MESSAGE_TYPES.CALLRESULT, messageId, { status: 'Accepted' }];
      connection.webSocket.send(JSON.stringify(remoteStopResponse));
      // Simulate stopping the transaction
      simulateStopTransaction(payload, deviceId);
      break;

    default:
      // Send NotImplemented for unknown actions
      const errorResponse = [MESSAGE_TYPES.CALLERROR, messageId, {
        errorCode: 'NotImplemented',
        errorDescription: `Action ${action} not implemented in simulator`
      }];
      connection.webSocket.send(JSON.stringify(errorResponse));
  }
}

// Simulate StartTransaction after RemoteStartTransaction
function simulateStartTransaction(remoteStartPayload, deviceId) {
  // Use provided deviceId or selected charging point
  const targetDeviceId = deviceId || selectedChargingPoint;
  const connectorId = remoteStartPayload.connectorId || selectedConnector || 1;
  const idTag = remoteStartPayload.idTag || 'SIMULATED';
  const meterStart = getRandomMeterValue();
  const timestamp = new Date().toISOString();

  // Save meterStart and timestamp in connector state (transactionId will be set after response)
  if (chargingPoints[targetDeviceId] && chargingPoints[targetDeviceId].connectors[connectorId]) {
    chargingPoints[targetDeviceId].connectors[connectorId].transaction = {
      transactionId: null, // will be set after response
      meterStart,
      timestamp,
      idTag
    };
  }

  // Send StartTransaction
  const payload = {
    connectorId,
    idTag,
    timestamp,
    meterStart
  };
  sendOCPPMessage('StartTransaction', payload, targetDeviceId);
}

// Simulate StopTransaction after RemoteStopTransaction
function simulateStopTransaction(remoteStopPayload, deviceId) {
  // Find the connector with the given transactionId
  const transactionId = remoteStopPayload.transactionId;
  let found = false;
  
  // If deviceId is provided, only check that specific charging point
  const devicesToCheck = deviceId ? [deviceId] : Object.keys(chargingPoints);
  
  for (const targetDeviceId of devicesToCheck) {
    for (const connectorId in chargingPoints[targetDeviceId].connectors) {
      const connector = chargingPoints[targetDeviceId].connectors[connectorId];
      if (connector.transaction && connector.transaction.transactionId == transactionId) {
        // Send StopTransaction
        const stopPayload = {
          transactionId,
          meterStop: connector.transaction.lastMeterValue || connector.transaction.meterStart,
          timestamp: new Date().toISOString(),
          idTag: connector.transaction.idTag,
          stopReason: 'PowerLoss'
        };
        sendOCPPMessage('StopTransaction', stopPayload, targetDeviceId);
        // Stop MeterValues
        stopMeterValues(targetDeviceId, connectorId);
        // Update status to Available
        connector.status = 'Available';
        sendStatusNotification('Available', targetDeviceId, connectorId);
        // Remove transaction info
        connector.transaction = null;
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (!found) {
    console.log('No active transaction found for transactionId', transactionId);
  }
}

// Heartbeat management for specific charging points
function startHeartbeat(deviceId) {
  const connection = chargingPointConnections[deviceId];
  if (!connection) {
    console.log(`No connection found for ${deviceId} - cannot start heartbeat`);
    return;
  }

  if (connection.heartbeatInterval) {
    clearInterval(connection.heartbeatInterval);
  }
  
  connection.heartbeatInterval = setInterval(() => {
    if (connection.isConnected) {
      sendHeartbeat(deviceId);
    }
  }, 30000); // 30 seconds

  console.log(`Started heartbeat for ${deviceId}`);
}

function stopHeartbeat(deviceId) {
  const connection = chargingPointConnections[deviceId];
  if (connection && connection.heartbeatInterval) {
    clearInterval(connection.heartbeatInterval);
    connection.heartbeatInterval = null;
    console.log(`Stopped heartbeat for ${deviceId}`);
  }
}

// Helper functions for session calculations
function calculateSessionDuration(transaction) {
  if (!transaction || !transaction.timestamp) return '0:00:00';
  
  const startTime = new Date(transaction.timestamp);
  const endTime = transaction.lastMeterValue ? new Date() : new Date();
  const durationMs = endTime - startTime;
  
  const hours = Math.floor(durationMs / (1000 * 60 * 60));
  const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((durationMs % (1000 * 60)) / 1000);
  
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function calculateSessionKWh(transaction) {
  if (!transaction) return 0;
  
  const meterStart = transaction.meterStart || 0;
  const meterStop = transaction.lastMeterValue || meterStart;
  
  // Return kWh, not Wh
  return parseFloat(((meterStop - meterStart) / 1000).toFixed(3));
}

// API Routes
app.get('/api/status', (req, res) => {
  // Get connection status for all charging points
  const connectionStatus = {};
  Object.keys(chargingPoints).forEach(deviceId => {
    const connection = chargingPointConnections[deviceId];
    connectionStatus[deviceId] = {
      isConnected: connection ? connection.isConnected : false,
      hasConnection: !!connection
    };
  });

  res.json({
    chargingPoints: chargingPoints,
    connectionStatus: connectionStatus,
    selectedChargingPoint: selectedChargingPoint,
    selectedConnector: selectedConnector,
    // Include transaction info for selected connector
    selectedTransaction: selectedChargingPoint && selectedConnector && 
      chargingPoints[selectedChargingPoint]?.connectors[selectedConnector]?.transaction || null
  });
});

app.get('/api/charging-points', (req, res) => {
  res.json({
    chargingPoints: chargingPoints,
    selectedChargingPoint: selectedChargingPoint,
    selectedConnector: selectedConnector
  });
});

app.get('/api/ocpp-messages', (req, res) => {
  res.json({
    messages: ocppMessages
  });
});

app.post('/api/clear-messages', (req, res) => {
  ocppMessages = [];
  res.json({ success: true, message: 'Messages cleared' });
});

// Clear logs for a specific device
app.post('/api/clear-logs', (req, res) => {
  const { deviceId } = req.body;
  if (deviceId) {
    // Clear logs for specific device
    logs = logs.filter(log => !log.deviceId || log.deviceId !== deviceId);
  } else {
    // Clear all logs
    logs = [];
  }
  res.json({ success: true, message: 'Logs cleared' });
});

// Delete a charging point
app.delete('/api/charging-points/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  
  if (!chargingPoints[deviceId]) {
    return res.status(404).json({ success: false, message: 'Charging point not found' });
  }
  
  try {
    // Disconnect if connected
    const connection = chargingPointConnections[deviceId];
    if (connection) {
      // Stop heartbeat first
      if (connection.heartbeatInterval) {
        clearInterval(connection.heartbeatInterval);
      }
      
      // Close WebSocket safely
      if (connection.webSocket) {
        try {
          connection.webSocket.close();
        } catch (error) {
          console.log(`Error closing WebSocket for ${deviceId}:`, error.message);
        }
      }
      
      // Remove connection
      delete chargingPointConnections[deviceId];
    }
    
    // Remove from charging points
    delete chargingPoints[deviceId];
    
    // Clear logs for this device
    logs = logs.filter(log => !log.deviceId || log.deviceId !== deviceId);
    
    // Clear OCPP messages for this device
    ocppMessages = ocppMessages.filter(msg => !msg.deviceId || msg.deviceId !== deviceId);
    
    // Clear any meter value intervals for this device
    const meterValueKeys = Object.keys(meterValuesIntervals).filter(key => key.startsWith(deviceId));
    meterValueKeys.forEach(key => {
      if (meterValuesIntervals[key]) {
        clearInterval(meterValuesIntervals[key]);
        delete meterValuesIntervals[key];
      }
    });
    
    // Reset selection if this was the selected charging point
    if (selectedChargingPoint === deviceId) {
      selectedChargingPoint = null;
      selectedConnector = null;
    }
    
    res.json({ success: true, message: `Charging point ${deviceId} deleted successfully` });
  } catch (error) {
    console.error(`Error deleting charging point ${deviceId}:`, error);
    res.status(500).json({ success: false, message: 'Error deleting charging point' });
  }
});

// Get charging sessions for a specific device
app.get('/api/charging-sessions/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  
  if (!chargingPoints[deviceId]) {
    return res.status(404).json({ success: false, message: 'Charging point not found' });
  }
  
  const sessions = [];
  const chargingPoint = chargingPoints[deviceId];
  
  Object.entries(chargingPoint.connectors).forEach(([connectorId, connector]) => {
    if (connector.transaction) {
      sessions.push({
        deviceId,
        connectorId: parseInt(connectorId),
        transactionId: connector.transaction.transactionId,
        status: connector.status,
        startTime: connector.transaction.timestamp,
        idTag: connector.transaction.idTag,
        meterStart: connector.transaction.meterStart,
        meterStop: connector.transaction.lastMeterValue || connector.transaction.meterStart,
        duration: calculateSessionDuration(connector.transaction),
        kwhConsumed: calculateSessionKWh(connector.transaction)
      });
    }
  });
  
  res.json({ success: true, sessions });
});

// Get all charging sessions
app.get('/api/charging-sessions', (req, res) => {
  const allSessions = [];
  
  Object.entries(chargingPoints).forEach(([deviceId, chargingPoint]) => {
    Object.entries(chargingPoint.connectors).forEach(([connectorId, connector]) => {
      if (connector.transaction) {
        allSessions.push({
          deviceId,
          connectorId: parseInt(connectorId),
          transactionId: connector.transaction.transactionId,
          status: connector.status,
          startTime: connector.transaction.timestamp,
          idTag: connector.transaction.idTag,
          meterStart: connector.transaction.meterStart,
          meterStop: connector.transaction.lastMeterValue || connector.transaction.meterStart,
          duration: calculateSessionDuration(connector.transaction),
          kwhConsumed: calculateSessionKWh(connector.transaction)
        });
      }
    });
  });
  
  res.json({ success: true, sessions: allSessions });
});

app.post('/api/charging-points', (req, res) => {
  console.log('Received charging point creation request:', req.body);
  const { deviceId, connectorCount = 1, power = 22, type = 'AC' } = req.body;
  
  if (!deviceId) {
    console.log('Device ID is missing');
    return res.status(400).json({ success: false, message: 'Device ID is required' });
  }

  // Create connectors
  const connectors = {};
  for (let i = 1; i <= connectorCount; i++) {
    connectors[i] = {
      id: i,
      status: 'Available',
      power: power,
      type: type
    };
  }

  chargingPoints[deviceId] = {
    deviceId: deviceId,
    connectors: connectors
  };

  // Automatically select the newly created charging point
  selectedChargingPoint = deviceId;
  selectedConnector = 1;

  console.log(`Created charging point: ${deviceId} with ${connectorCount} connectors`);
  console.log(`Auto-selected: ${deviceId}, connector: ${selectedConnector}`);
  console.log('Current charging points:', chargingPoints);
  res.json({ 
    success: true, 
    chargingPoints,
    selectedChargingPoint: deviceId,
    selectedConnector: 1
  });
});

app.post('/api/select-charging-point', (req, res) => {
  const { deviceId, connectorId } = req.body;
  
  if (!chargingPoints[deviceId]) {
    return res.status(400).json({ success: false, message: 'Charging point not found' });
  }

  selectedChargingPoint = deviceId;
  selectedConnector = connectorId || 1;

  console.log(`Selected charging point: ${deviceId}, connector: ${selectedConnector}`);
  res.json({ 
    success: true, 
    selectedChargingPoint, 
    selectedConnector,
    connectors: chargingPoints[deviceId].connectors
  });
});

app.post('/api/connect', (req, res) => {
  const { deviceId } = req.body;
  
  if (!deviceId) {
    return res.status(400).json({ success: false, message: 'Device ID is required' });
  }

  if (!chargingPoints[deviceId]) {
    return res.status(400).json({ success: false, message: 'Charging point not found' });
  }

  const connection = chargingPointConnections[deviceId];
  if (connection && connection.isConnected) {
    return res.json({ success: false, message: 'Already connected' });
  }
  
  connectToOCPP(deviceId);
  res.json({ success: true, message: `Connecting to OCPP server for ${deviceId}...` });
});

app.post('/api/disconnect', (req, res) => {
  const { deviceId } = req.body;
  
  if (!deviceId) {
    return res.status(400).json({ success: false, message: 'Device ID is required' });
  }

  const connection = chargingPointConnections[deviceId];
  if (connection && connection.webSocket) {
    connection.webSocket.close();
    stopHeartbeat(deviceId);
  }
  res.json({ success: true, message: `Disconnected from OCPP server for ${deviceId}` });
});

app.post('/api/status-notification', (req, res) => {
  const { status, deviceId, connectorId } = req.body;
  
  if (!STATUS_VALUES[status]) {
    return res.json({ success: false, message: 'Invalid status' });
  }

  if (deviceId && connectorId) {
    // Update specific connector status
    if (chargingPoints[deviceId] && chargingPoints[deviceId].connectors[connectorId]) {
      chargingPoints[deviceId].connectors[connectorId].status = STATUS_VALUES[status];
      
      // Send status notification for this specific charging point
      sendStatusNotification(STATUS_VALUES[status], deviceId, connectorId);
      // Stop MeterValues if not Charging
      if (STATUS_VALUES[status] !== 'Charging') {
        stopMeterValues(deviceId, connectorId);
      }
      
      res.json({ 
        success: true, 
        message: `Status changed to ${STATUS_VALUES[status]} for ${deviceId}:${connectorId}` 
      });
    } else {
      res.json({ success: false, message: 'Charging point or connector not found' });
    }
  } else {
    // Use selected charging point and connector
    if (!selectedChargingPoint || !selectedConnector) {
      return res.json({ success: false, message: 'No charging point or connector selected' });
    }
    
    if (chargingPoints[selectedChargingPoint] && chargingPoints[selectedChargingPoint].connectors[selectedConnector]) {
      chargingPoints[selectedChargingPoint].connectors[selectedConnector].status = STATUS_VALUES[status];
      sendStatusNotification(STATUS_VALUES[status], selectedChargingPoint, selectedConnector);
      // Stop MeterValues if not Charging
      if (STATUS_VALUES[status] !== 'Charging') {
        stopMeterValues(selectedChargingPoint, selectedConnector);
      }
      
      res.json({ 
        success: true, 
        message: `Status changed to ${STATUS_VALUES[status]} for ${selectedChargingPoint}:${selectedConnector}` 
      });
    } else {
      res.json({ success: false, message: 'Selected charging point or connector not found' });
    }
  }
});

// API to get transaction info for frontend
app.get('/api/transaction-info', (req, res) => {
  const { deviceId, connectorId } = req.query;
  if (deviceId && connectorId && chargingPoints[deviceId] && chargingPoints[deviceId].connectors[connectorId]) {
    const transaction = chargingPoints[deviceId].connectors[connectorId].transaction;
    res.json({ transaction });
  } else {
    res.json({ transaction: null });
  }
});

// API to manually stop charging
app.post('/api/stop-charging', (req, res) => {
  const { deviceId, connectorId } = req.body;
  
  if (!deviceId || !connectorId) {
    return res.status(400).json({ success: false, message: 'Device ID and connector ID are required' });
  }

  if (!chargingPoints[deviceId]) {
    return res.status(404).json({ success: false, message: 'Charging point not found' });
  }

  const connector = chargingPoints[deviceId].connectors[connectorId];
  if (!connector) {
    return res.status(404).json({ success: false, message: 'Connector not found' });
  }

  if (!connector.transaction || !connector.transaction.transactionId) {
    return res.status(400).json({ success: false, message: 'No active transaction found for this connector' });
  }

  try {
    // Send StopTransaction
    const stopPayload = {
      transactionId: connector.transaction.transactionId,
      meterStop: connector.transaction.lastMeterValue || connector.transaction.meterStart,
      timestamp: new Date().toISOString(),
      idTag: connector.transaction.idTag,
      stopReason: 'PowerLoss'
    };
    
    sendOCPPMessage('StopTransaction', stopPayload, deviceId);
    
    // Stop MeterValues
    stopMeterValues(deviceId, connectorId);
    
    // Update status to Available
    connector.status = 'Available';
    sendStatusNotification('Available', deviceId, connectorId);
    
    // Remove transaction info
    connector.transaction = null;
    
    res.json({ 
      success: true, 
      message: `Charging stopped for ${deviceId}:${connectorId}`,
      transactionId: stopPayload.transactionId,
      meterStop: stopPayload.meterStop
    });
  } catch (error) {
    console.error(`Error stopping charging for ${deviceId}:${connectorId}:`, error);
    res.status(500).json({ success: false, message: 'Error stopping charging' });
  }
});

// Start server
app.listen(config.port, () => {
  console.log(`OCPP Simulator server running on port ${config.port}`);
});

// Global error handler to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
}); 