const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── CONFIG ──────────────────────────────────────────
const MONGO_URI = 'mongodb+srv://queproficial_db_user:K6SHFRECJHffhZIc@cluster0.t8dr4dl.mongodb.net/?appName=Cluster0';
const DISCORD_CLIENT_ID = '1489699802462687374';
const DISCORD_CLIENT_SECRET = 'gy9YIheksoposj2qQPquN-7iXGgTmQoi';
const PORT = process.env.PORT || 3000;

let db, votesCol, votersCol, settingsCol, partiesCol;

// ── DATABASE ─────────────────────────────────────────
async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db('elections_sb');
  votesCol     = db.collection('votes');
  votersCol    = db.collection('voters');
  settingsCol  = db.collection('settings');
  partiesCol   = db.collection('parties');
  console.log('✅ MongoDB connected');

  // Init election settings if not exist
  const existing = await settingsCol.findOne({ key: 'election' });
  if (!existing) {
    await settingsCol.insertOne({ key: 'election', active: true });
  }
}

// ── DISCORD AUTH ──────────────────────────────────────
app.post('/api/auth/discord', async (req, res) => {
  const { code, redirect_uri } = req.body;
  if (!code || !redirect_uri) return res.status(400).json({ error: 'Missing params' });

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(400).json({ error: 'Token exchange failed', detail: tokenData });

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const user = await userRes.json();
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── VOTES ─────────────────────────────────────────────
app.post('/api/votes', async (req, res) => {
  try {
    const vote = req.body;
    if (!vote.discordId || !vote.partyId) return res.status(400).json({ error: 'Missing fields' });

    // Duplicate check
    const exists = await votersCol.findOne({ discordId: vote.discordId });
    if (exists) return res.status(409).json({ error: 'Ya has votado' });

    // Check election active
    const settings = await settingsCol.findOne({ key: 'election' });
    if (!settings?.active) return res.status(403).json({ error: 'Elecciones no activas' });

    await votesCol.insertOne({ partyId: vote.partyId, date: new Date() });
    await votersCol.insertOne({ ...vote, date: new Date() });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/votes', async (req, res) => {
  try {
    const votes = await votesCol.find({}).toArray();
    res.json(votes);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN ─────────────────────────────────────────────
app.get('/api/admin/stats', async (req, res) => {
  try {
    const votes   = await votesCol.find({}, { projection: { partyId: 1 } }).toArray();
    const voters  = await votersCol.find({}).toArray();
    const settings = await settingsCol.findOne({ key: 'election' });
    res.json({ votes, voters, electionActive: settings?.active ?? true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/election', async (req, res) => {
  try {
    const { active } = req.body;
    await settingsCol.updateOne({ key: 'election' }, { $set: { active } }, { upsert: true });
    res.json({ ok: true, active });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/parties', async (req, res) => {
  try {
    const parties = await partiesCol.find({}).toArray();
    res.json(parties);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/parties', async (req, res) => {
  try {
    await partiesCol.insertOne(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/parties/:id', async (req, res) => {
  try {
    await partiesCol.deleteOne({ id: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── START ─────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🗳  Server running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('DB connection failed:', err.message);
  // Start anyway (frontend works standalone)
  app.listen(PORT, () => console.log(`🗳  Server running (no DB) on http://localhost:${PORT}`));
});
