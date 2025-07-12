import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [chargingPoints, setChargingPoints] = useState({});
  const [selectedChargingPoint, setSelectedChargingPoint] = useState(null);
  const [selectedConnector, setSelectedConnector] = useState(null);
  const [newChargingPoint, setNewChargingPoint] = useState({
    deviceId: '',
    connectorCount: 1,
    power: 22,
    type: 'AC'
  });

  const [connectionStatus, setConnectionStatus] = useState({
    connected: false,
    loading: false
  });

  const [logs, setLogs] = useState([]);
  const [ocppMessages, setOcppMessages] = useState([]);
  const [transactionInfo, setTransactionInfo] = useState(null);
  const [activeTab, setActiveTab] = useState('charging-points');
  const [viewMode, setViewMode] = useState('list'); // 'list', 'create', 'details', or 'sessions'
  const [chargingSessions, setChargingSessions] = useState([]);

  // Status options for the dropdown
  const statusOptions = [
    'Available',
    'Occupied', 
    'Reserved',
    'Unavailable',
    'Faulted',
    'Finishing',
    'Preparing',
    'Charging'
  ];

  // Fetch current status on component mount
  useEffect(() => {
    fetchStatus();
  }, []);

  // Fetch status more frequently to catch backend changes
  useEffect(() => {
    const statusInterval = setInterval(() => {
      fetchStatus();
    }, 2000); // Poll every 2 seconds to reduce connection load

    return () => clearInterval(statusInterval);
  }, []);

  // Also fetch status when connection status changes
  useEffect(() => {
    if (connectionStatus.connected) {
      fetchStatus();
    }
  }, [connectionStatus.connected]);

  // Fetch OCPP messages periodically
  useEffect(() => {
    const interval = setInterval(() => {
      fetchOcppMessages();
    }, 3000); // Fetch every 3 seconds to reduce load

    return () => clearInterval(interval);
  }, []);

  // Fetch transaction info when selection changes or every 2 seconds
  useEffect(() => {
    fetchTransactionInfo();
    const interval = setInterval(fetchTransactionInfo, 2000);
    return () => clearInterval(interval);
  }, [selectedChargingPoint, selectedConnector]);

  useEffect(() => {
    let interval;
    if (viewMode === 'sessions' && selectedChargingPoint) {
      const fetchSessions = async () => {
        try {
          const res = await axios.get(`/api/charging-sessions/${selectedChargingPoint}`);
          if (res.data.success) setChargingSessions(res.data.sessions);
        } catch (e) {}
      };
      fetchSessions();
      interval = setInterval(fetchSessions, 2000);
    }
    return () => clearInterval(interval);
  }, [viewMode, selectedChargingPoint]);

  const [connectionStatuses, setConnectionStatuses] = useState({});

  const fetchStatus = async () => {
    try {
      const response = await axios.get('/api/status', { timeout: 5000 });
      
      // Update connection statuses for all charging points
      setConnectionStatuses(response.data.connectionStatus || {});
      
      // Update connection status for selected charging point
      const selectedConnectionStatus = selectedChargingPoint && response.data.connectionStatus && response.data.connectionStatus[selectedChargingPoint];
      
      setConnectionStatus({
        connected: selectedConnectionStatus ? selectedConnectionStatus.isConnected : false,
        loading: false
      });
      
      setChargingPoints(response.data.chargingPoints || {});
      setSelectedChargingPoint(response.data.selectedChargingPoint);
      setSelectedConnector(response.data.selectedConnector);
      
      // Update transaction info immediately if available
      if (response.data.selectedTransaction) {
        setTransactionInfo(response.data.selectedTransaction);
      }
    } catch (error) {
      console.error('Error fetching status:', error);
      // Don't add error log for network issues to avoid spam
      if (error.code !== 'ECONNABORTED' && error.code !== 'ERR_NETWORK') {
        addLog('Error fetching status', 'error');
      }
    }
  };

  const fetchOcppMessages = async () => {
    try {
      const response = await axios.get('/api/ocpp-messages', { timeout: 5000 });
      setOcppMessages(response.data.messages || []);
    } catch (error) {
      console.error('Error fetching OCPP messages:', error);
      // Don't log network errors to avoid spam
    }
  };

  const clearOcppMessages = async () => {
    try {
      await axios.post('/api/clear-messages');
      setOcppMessages([]);
      addLog('OCPP messages cleared', 'info');
    } catch (error) {
      console.error('Error clearing OCPP messages:', error);
      addLog('Error clearing OCPP messages', 'error');
    }
  };

  const fetchTransactionInfo = async () => {
    if (selectedChargingPoint && selectedConnector) {
      try {
        const response = await axios.get('/api/transaction-info', {
          params: {
            deviceId: selectedChargingPoint,
            connectorId: selectedConnector
          },
          timeout: 5000
        });
        setTransactionInfo(response.data.transaction);
      } catch (error) {
        setTransactionInfo(null);
      }
    } else {
      setTransactionInfo(null);
    }
  };

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { message, type, timestamp }]);
  };

  const handleNewChargingPointChange = (field, value) => {
    setNewChargingPoint(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleCreateChargingPoint = async () => {
    try {
      console.log('Creating charging point with data:', newChargingPoint);
      setConnectionStatus(prev => ({ ...prev, loading: true }));
      const response = await axios.post('/api/charging-points', newChargingPoint);
      console.log('Charging point creation response:', response.data);
      addLog(`Charging point ${newChargingPoint.deviceId} created successfully`, 'success');
      setNewChargingPoint({ deviceId: '', connectorCount: 1, power: 22, type: 'AC' });
      
      // Refresh the status to get the new charging point
      await fetchStatus();
      
      // Redirect to list view to show the new charging point
      setViewMode('list');
    } catch (error) {
      console.error('Error creating charging point:', error);
      console.error('Error response:', error.response?.data);
      addLog(`Error creating charging point: ${error.response?.data?.message || error.message}`, 'error');
    } finally {
      setConnectionStatus(prev => ({ ...prev, loading: false }));
    }
  };

  const handleSelectChargingPoint = async (deviceId, connectorId = 1) => {
    try {
      const response = await axios.post('/api/select-charging-point', { deviceId, connectorId });
      setSelectedChargingPoint(deviceId);
      setSelectedConnector(connectorId);
      addLog(`Selected charging point: ${deviceId}, connector: ${connectorId}`, 'success');
      fetchStatus();
    } catch (error) {
      console.error('Error selecting charging point:', error);
      addLog('Error selecting charging point', 'error');
    }
  };

  const handleConnect = async () => {
    if (!selectedChargingPoint) {
      addLog('Please select a charging point first', 'error');
      return;
    }

    try {
      setConnectionStatus(prev => ({ ...prev, loading: true }));
      const response = await axios.post('/api/connect', { deviceId: selectedChargingPoint });
      addLog(response.data.message, 'info');
      
      // Poll for connection status
      const pollStatus = setInterval(async () => {
        const statusResponse = await axios.get('/api/status');
        const connectionStatus = statusResponse.data.connectionStatus;
        if (connectionStatus && connectionStatus[selectedChargingPoint] && connectionStatus[selectedChargingPoint].isConnected) {
          setConnectionStatus({ connected: true, loading: false });
          addLog(`Successfully connected to OCPP server for ${selectedChargingPoint}`, 'success');
          clearInterval(pollStatus);
        }
      }, 1000);

      // Stop polling after 10 seconds
      setTimeout(() => {
        clearInterval(pollStatus);
        if (!connectionStatus.connected) {
          setConnectionStatus(prev => ({ ...prev, loading: false }));
          addLog('Connection timeout', 'error');
        }
      }, 10000);

    } catch (error) {
      console.error('Error connecting:', error);
      addLog('Error connecting to OCPP server', 'error');
      setConnectionStatus(prev => ({ ...prev, loading: false }));
    }
  };

  const handleDisconnect = async () => {
    if (!selectedChargingPoint) {
      addLog('Please select a charging point first', 'error');
      return;
    }

    try {
      const response = await axios.post('/api/disconnect', { deviceId: selectedChargingPoint });
      addLog(response.data.message, 'info');
      setConnectionStatus({ connected: false, loading: false });
    } catch (error) {
      console.error('Error disconnecting:', error);
      addLog('Error disconnecting from OCPP server', 'error');
    }
  };

  const handleStatusChange = async (status, deviceId = selectedChargingPoint, connectorId = selectedConnector) => {
    try {
      const response = await axios.post('/api/status-notification', { 
        status, 
        deviceId, 
        connectorId 
      });
      
      if (connectionStatus.connected) {
        addLog(`Status changed to: ${status} for ${deviceId}:${connectorId} (OCPP notification sent)`, 'success');
      } else {
        addLog(`Status changed to: ${status} for ${deviceId}:${connectorId} (local only)`, 'info');
      }
      
      fetchStatus(); // Refresh to get updated status
    } catch (error) {
      console.error('Error changing status:', error);
      addLog('Error changing status', 'error');
    }
  };

  const handleViewDetails = (deviceId) => {
    setSelectedChargingPoint(deviceId);
    setSelectedConnector(1);
    setViewMode('details');
    addLog(`Viewing details for ${deviceId}`, 'info');
  };

  const handleViewSessions = async (deviceId) => {
    try {
      const response = await axios.get(`/api/charging-sessions/${deviceId}`);
      if (response.data.success) {
        setChargingSessions(response.data.sessions);
        setSelectedChargingPoint(deviceId);
        setViewMode('sessions');
        addLog(`Viewing sessions for ${deviceId}`, 'info');
      }
    } catch (error) {
      console.error('Error fetching sessions:', error);
      addLog('Error fetching charging sessions', 'error');
    }
  };

  const handleDeleteChargingPoint = async (deviceId) => {
    if (!window.confirm(`Are you sure you want to delete charging point ${deviceId}?`)) {
      return;
    }
    
    try {
      const response = await axios.delete(`/api/charging-points/${deviceId}`);
      if (response.data.success) {
        addLog(`Deleted charging point ${deviceId}`, 'success');
        
        // Clear any selected charging point if it was the deleted one
        if (selectedChargingPoint === deviceId) {
          setSelectedChargingPoint(null);
          setSelectedConnector(null);
        }
        
        // Force refresh the status to update the UI
        await fetchStatus();
        
        // If we're in details or sessions view for the deleted device, go back to list
        if (viewMode === 'details' || viewMode === 'sessions') {
          setViewMode('list');
        }
      }
    } catch (error) {
      console.error('Error deleting charging point:', error);
      addLog('Error deleting charging point', 'error');
    }
  };

  const handleClearLogs = async (deviceId = null) => {
    try {
      await axios.post('/api/clear-logs', { deviceId });
      setLogs([]);
      addLog('Logs cleared', 'info');
    } catch (error) {
      console.error('Error clearing logs:', error);
      addLog('Error clearing logs', 'error');
    }
  };

  const handleClearMessages = async () => {
    try {
      await axios.post('/api/clear-messages');
      setOcppMessages([]);
      addLog('OCPP messages cleared', 'info');
    } catch (error) {
      console.error('Error clearing messages:', error);
      addLog('Error clearing messages', 'error');
    }
  };

  const calculateSessionKWh = (transaction) => {
    if (!transaction || !transaction.lastMeterValue || !transaction.meterStart) return 0;
    return ((transaction.lastMeterValue - transaction.meterStart) / 1000).toFixed(3);
  };

  const calculateSessionDuration = (transaction) => {
    if (!transaction || !transaction.timestamp) return '0:00';
    const start = new Date(transaction.timestamp);
    const now = new Date();
    const diffMs = now - start;
    const diffMins = Math.floor(diffMs / 60000);
    const diffSecs = Math.floor((diffMs % 60000) / 1000);
    return `${diffMins}:${diffSecs.toString().padStart(2, '0')}`;
  };

  function renderView() {
    if (viewMode === 'list') {
      // List View - Show all charging points
      return (
        <div className="list-view">
          <div className="header-section">
            <h2>Charging Points</h2>
            <button 
              onClick={() => setViewMode('create')}
              className="btn btn-primary"
            >
              Create New Charging Point
            </button>
          </div>

          <div className="charging-points-table">
            {Object.keys(chargingPoints).length === 0 ? (
              <div className="empty-state">
                <p>No charging points created yet.</p>
                <button 
                  onClick={() => setViewMode('create')}
                  className="btn btn-primary"
                >
                  Create Your First Charging Point
                </button>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Device ID</th>
                    <th>Connectors</th>
                    <th>Power</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Connection</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(chargingPoints).map(([deviceId, chargingPoint]) => (
                    <tr key={deviceId} className="charging-point-row">
                      <td>{deviceId}</td>
                      <td>{Object.keys(chargingPoint.connectors).length}</td>
                      <td>{chargingPoint.connectors[1]?.power || 0} kW</td>
                      <td>{chargingPoint.connectors[1]?.type || 'AC'}</td>
                      <td>
                        <span className={`status-badge ${chargingPoint.connectors[1]?.status?.toLowerCase() || 'available'}`}>
                          {chargingPoint.connectors[1]?.status || 'Available'}
                        </span>
                      </td>
                      <td>
                        <span className={`connection-status ${connectionStatuses[deviceId]?.isConnected ? 'connected' : 'disconnected'}`}>
                          {connectionStatuses[deviceId]?.isConnected ? 'Connected' : 'Disconnected'}
                        </span>
                      </td>
                      <td>
                        <div className="action-buttons">
                          <button
                            onClick={() => handleViewDetails(deviceId)}
                            className="btn btn-secondary btn-sm"
                          >
                            Details
                          </button>
                          <button
                            onClick={() => handleViewSessions(deviceId)}
                            className="btn btn-info btn-sm"
                          >
                            Sessions
                          </button>
                          <button
                            onClick={() => handleDeleteChargingPoint(deviceId)}
                            className="btn btn-danger btn-sm"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      );
    }
    if (viewMode === 'create') {
      // Create View
      return (
        <div className="create-view">
          <div className="header-section">
            <h2>Create New Charging Point</h2>
            <button 
              onClick={() => setViewMode('list')}
              className="btn btn-secondary"
            >
              ← Back to List
            </button>
          </div>

          <div className="card">
            <div className="form-grid">
              <div className="form-group">
                <label>Device ID:</label>
                <input
                  type="text"
                  value={newChargingPoint.deviceId}
                  onChange={(e) => handleNewChargingPointChange('deviceId', e.target.value)}
                  placeholder="Enter device ID (e.g., CP001)"
                />
              </div>

              <div className="form-group">
                <label>Number of Connectors:</label>
                <input
                  type="number"
                  value={newChargingPoint.connectorCount}
                  onChange={(e) => handleNewChargingPointChange('connectorCount', parseInt(e.target.value))}
                  min="1"
                  max="10"
                />
              </div>

              <div className="form-group">
                <label>Power (kW):</label>
                <input
                  type="number"
                  value={newChargingPoint.power}
                  onChange={(e) => handleNewChargingPointChange('power', parseFloat(e.target.value))}
                  step="0.1"
                />
              </div>

              <div className="form-group">
                <label>Type:</label>
                <select
                  value={newChargingPoint.type}
                  onChange={(e) => handleNewChargingPointChange('type', e.target.value)}
                >
                  <option value="AC">AC</option>
                  <option value="DC">DC</option>
                </select>
              </div>
            </div>

            <button 
              onClick={handleCreateChargingPoint}
              disabled={connectionStatus.loading || !newChargingPoint.deviceId}
              className="btn btn-primary"
            >
              {connectionStatus.loading ? 'Creating...' : 'Create Charging Point'}
            </button>
          </div>
        </div>
      );
    }
    if (viewMode === 'details') {
      // Details View
      return (
        <div className="details-view">
          <div className="header-section">
            <h2>Charging Point Details: {selectedChargingPoint}</h2>
            <button 
              onClick={() => setViewMode('list')}
              className="btn btn-secondary"
            >
              ← Back to List
            </button>
          </div>

          <div className="details-content">
            <div className="card">
              <h3>Connection Control</h3>
              <div className="connection-status">
                <span className={`status-indicator ${connectionStatus.connected ? 'connected' : 'disconnected'}`}>
                  {connectionStatus.connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>

              <div className="button-group">
                <button
                  onClick={handleConnect}
                  disabled={connectionStatus.connected || connectionStatus.loading}
                  className="btn btn-success"
                >
                  {connectionStatus.loading ? 'Connecting...' : 'Connect'}
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={!connectionStatus.connected || connectionStatus.loading}
                  className="btn btn-danger"
                >
                  Disconnect
                </button>
              </div>
            </div>

            <div className="card">
              <h3>Status Control</h3>
              <div className="status-buttons">
                {statusOptions.map(status => (
                  <button
                    key={status}
                    onClick={() => handleStatusChange(status)}
                    disabled={!selectedChargingPoint || !selectedConnector}
                    className={`btn btn-status ${chargingPoints[selectedChargingPoint]?.connectors[selectedConnector]?.status === status ? 'active' : ''}`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <h3>OCPP Messages</h3>
              <div className="ocpp-messages">
                {ocppMessages.length === 0 ? (
                  <p>No OCPP messages yet. Connect to see messages.</p>
                ) : (
                  <div className="messages-list">
                    {ocppMessages.map((msg) => (
                      <div key={msg.id} className={`message-entry ${msg.direction}`}>
                        <div className="message-header">
                          <span className={`direction-badge ${msg.direction}`}>
                            {msg.direction === 'sent' ? '→ SENT' : '← RECEIVED'}
                          </span>
                          <span className="action-name">{msg.action}</span>
                          <span className="timestamp">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div className="message-content">
                          <pre>{JSON.stringify(msg.message, null, 2)}</pre>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button 
                onClick={clearOcppMessages}
                className="btn btn-secondary"
              >
                Clear Messages
              </button>
            </div>

            <div className="card">
              <h3>Activity Logs</h3>
              <div className="logs">
                {logs.map((log, index) => (
                  <div key={index} className={`log-entry ${log.type}`}>
                    <span className="timestamp">{log.timestamp}</span>
                    <span className="message">{log.message}</span>
                  </div>
                ))}
              </div>
              <button 
                onClick={() => setLogs([])}
                className="btn btn-secondary"
              >
                Clear Logs
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (viewMode === 'sessions') {
      // Sessions View
      return (
        <div className="sessions-view">
          <div className="header-section">
            <h2>Charging Sessions: {selectedChargingPoint}</h2>
            <button 
              onClick={() => setViewMode('list')}
              className="btn btn-secondary"
            >
              ← Back to List
            </button>
          </div>

          <div className="card">
            <h3>Active Charging Sessions</h3>
            {chargingSessions.length === 0 ? (
              <div className="empty-state">
                <p>No active charging sessions for this device.</p>
              </div>
            ) : (
              <div className="sessions-table">
                <table>
                  <thead>
                    <tr>
                      <th>Connector</th>
                      <th>Transaction ID</th>
                      <th>Status</th>
                      <th>Start Time</th>
                      <th>Duration</th>
                      <th>kWh Consumed</th>
                      <th>IdTag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chargingSessions.map((session, index) => (
                      <tr key={index} className="session-row">
                        <td>{session.connectorId}</td>
                        <td>{session.transactionId || '-'}</td>
                        <td>
                          <span className={`status-badge ${session.status.toLowerCase()}`}>
                            {session.status}
                          </span>
                        </td>
                        <td>{new Date(session.startTime).toLocaleString()}</td>
                        <td>{session.duration}</td>
                        <td>{session.kwhConsumed} kWh</td>
                        <td>{session.idTag}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>OCPP 1.6J Charging Point Simulator</h1>
      </header>

      <div className="main-container">
        {renderView()}
      </div>
    </div>
  );
}

export default App; 