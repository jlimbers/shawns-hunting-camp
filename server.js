const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 3100;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Data file paths
const STANDS_FILE = path.join(__dirname, 'data', 'stands.json');
const HUNTERS_FILE = path.join(__dirname, 'data', 'hunters.json');
const ACTIVITY_FILE = path.join(__dirname, 'data', 'activity.json');

// Helper functions
async function readJSON(file) {
  const data = await fs.readFile(file, 'utf8');
  return JSON.parse(data);
}

async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// API Routes

// Get all stands
app.get('/api/stands', async (req, res) => {
  try {
    const stands = await readJSON(STANDS_FILE);
    res.json(stands);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load stands' });
  }
});

// Get all hunters
app.get('/api/hunters', async (req, res) => {
  try {
    const hunters = await readJSON(HUNTERS_FILE);
    // Don't send PINs to client
    const sanitized = hunters.map(h => ({
      id: h.id,
      name: h.name,
      isAdmin: h.isAdmin,
      currentStand: h.currentStand
    }));
    res.json(sanitized);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load hunters' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { name, pin } = req.body;
    const hunters = await readJSON(HUNTERS_FILE);
    const hunter = hunters.find(h => h.name === name && h.pin === pin);
    
    if (hunter) {
      res.json({
        id: hunter.id,
        name: hunter.name,
        isAdmin: hunter.isAdmin,
        currentStand: hunter.currentStand
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Check in to stand
app.post('/api/checkin', async (req, res) => {
  try {
    const { hunterId, standId } = req.body;
    const stands = await readJSON(STANDS_FILE);
    const hunters = await readJSON(HUNTERS_FILE);
    const activity = await readJSON(ACTIVITY_FILE);
    
    const stand = stands.find(s => s.id === standId);
    const hunter = hunters.find(h => h.id === hunterId);
    
    if (!stand || !hunter) {
      return res.status(404).json({ error: 'Stand or hunter not found' });
    }
    
    if (stand.occupied) {
      return res.status(400).json({ error: 'Stand is already occupied' });
    }
    
    // Check out from previous stand if any
    if (hunter.currentStand) {
      const oldStand = stands.find(s => s.id === hunter.currentStand);
      if (oldStand) {
        oldStand.occupied = false;
        oldStand.hunter = null;
        oldStand.checkInTime = null;
      }
    }
    
    // Check in to new stand
    stand.occupied = true;
    stand.hunter = hunter.name;
    stand.checkInTime = new Date().toISOString();
    hunter.currentStand = standId;
    
    // Log activity
    activity.push({
      id: activity.length + 1,
      type: 'checkin',
      hunter: hunter.name,
      stand: stand.name,
      timestamp: new Date().toISOString()
    });
    
    await writeJSON(STANDS_FILE, stands);
    await writeJSON(HUNTERS_FILE, hunters);
    await writeJSON(ACTIVITY_FILE, activity);
    
    res.json({ success: true, stand, hunter });
  } catch (error) {
    res.status(500).json({ error: 'Check-in failed' });
  }
});

// Check out
app.post('/api/checkout', async (req, res) => {
  try {
    const { hunterId } = req.body;
    const stands = await readJSON(STANDS_FILE);
    const hunters = await readJSON(HUNTERS_FILE);
    const activity = await readJSON(ACTIVITY_FILE);
    
    const hunter = hunters.find(h => h.id === hunterId);
    
    if (!hunter || !hunter.currentStand) {
      return res.status(400).json({ error: 'Hunter not checked in' });
    }
    
    const stand = stands.find(s => s.id === hunter.currentStand);
    
    if (stand) {
      stand.occupied = false;
      stand.hunter = null;
      stand.checkInTime = null;
    }
    
    // Log activity
    activity.push({
      id: activity.length + 1,
      type: 'checkout',
      hunter: hunter.name,
      stand: stand ? stand.name : 'Unknown',
      timestamp: new Date().toISOString()
    });
    
    hunter.currentStand = null;
    
    await writeJSON(STANDS_FILE, stands);
    await writeJSON(HUNTERS_FILE, hunters);
    await writeJSON(ACTIVITY_FILE, activity);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Check-out failed' });
  }
});

// Get activity log
app.get('/api/activity', async (req, res) => {
  try {
    const activity = await readJSON(ACTIVITY_FILE);
    // Return last 50 entries, newest first
    res.json(activity.slice(-50).reverse());
  } catch (error) {
    res.status(500).json({ error: 'Failed to load activity' });
  }
});

// Log sighting/harvest
app.post('/api/log', async (req, res) => {
  try {
    const { hunterId, type, description } = req.body;
    const hunters = await readJSON(HUNTERS_FILE);
    const activity = await readJSON(ACTIVITY_FILE);
    
    const hunter = hunters.find(h => h.id === hunterId);
    
    if (!hunter) {
      return res.status(404).json({ error: 'Hunter not found' });
    }
    
    activity.push({
      id: activity.length + 1,
      type: type || 'sighting',
      hunter: hunter.name,
      description,
      timestamp: new Date().toISOString()
    });
    
    await writeJSON(ACTIVITY_FILE, activity);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to log activity' });
  }
});

// Admin: Add hunter
app.post('/api/admin/hunters', async (req, res) => {
  try {
    const { name, pin, isAdmin } = req.body;
    const hunters = await readJSON(HUNTERS_FILE);
    
    const newHunter = {
      id: hunters.length + 1,
      name,
      pin: pin || '0000',
      isAdmin: isAdmin || false,
      currentStand: null
    };
    
    hunters.push(newHunter);
    await writeJSON(HUNTERS_FILE, hunters);
    
    res.json({ success: true, hunter: { id: newHunter.id, name: newHunter.name, isAdmin: newHunter.isAdmin } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add hunter' });
  }
});

// Admin: Remove hunter
app.delete('/api/admin/hunters/:id', async (req, res) => {
  try {
    const hunterId = parseInt(req.params.id);
    const hunters = await readJSON(HUNTERS_FILE);
    const stands = await readJSON(STANDS_FILE);
    
    const hunter = hunters.find(h => h.id === hunterId);
    
    if (hunter && hunter.currentStand) {
      // Check out if currently checked in
      const stand = stands.find(s => s.id === hunter.currentStand);
      if (stand) {
        stand.occupied = false;
        stand.hunter = null;
        stand.checkInTime = null;
        await writeJSON(STANDS_FILE, stands);
      }
    }
    
    const filtered = hunters.filter(h => h.id !== hunterId);
    await writeJSON(HUNTERS_FILE, filtered);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove hunter' });
  }
});

// Admin: Update stand
app.put('/api/admin/stands/:id', async (req, res) => {
  try {
    const standId = parseInt(req.params.id);
    const { name } = req.body;
    const stands = await readJSON(STANDS_FILE);
    
    const stand = stands.find(s => s.id === standId);
    
    if (!stand) {
      return res.status(404).json({ error: 'Stand not found' });
    }
    
    stand.name = name;
    await writeJSON(STANDS_FILE, stands);
    
    res.json({ success: true, stand });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update stand' });
  }
});

// Weather proxy (using wttr.in)
app.get('/api/weather', async (req, res) => {
  try {
    const location = req.query.location || 'auto';
    const response = await fetch(`https://wttr.in/${location}?format=j1`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Weather unavailable' });
  }
});

app.listen(PORT, () => {
  console.log(`🦌 Hunting Camp Dashboard running on port ${PORT}`);
  console.log(`   http://localhost:${PORT}`);
});
