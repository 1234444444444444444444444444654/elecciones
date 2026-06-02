const express  = require('express');
const { MongoClient } = require('mongodb');
const cors     = require('cors');
const path     = require('path');
const app      = express();

app.use(cors({
  origin: [
    'https://1234444444444444444444444444654.github.io/elecciones/',  // ← tu URL de GitHub Pages exacta
    'http://localhost:3000'
  ]
}));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── CONFIG ───────────────────────────────────────────────────────────────────
const MONGO_URI            = 'mongodb+srv://queproficial_db_user:K6SHFRECJHffhZIc@cluster0.t8dr4dl.mongodb.net/?appName=Cluster0';
const DISCORD_CLIENT_ID    = '1489699802462687374';
const DISCORD_CLIENT_SECRET= 'gy9YIheksoposj2qQPquN-7iXGgTmQoi';
const PORT                 = process.env.PORT || 3000;

let db, votesCol, votersCol, settingsCol, partiesCol;

// ── DATABASE ─────────────────────────────────────────────────────────────────
async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db           = client.db('elections_sb');
  votesCol     = db.collection('votes');
  votersCol    = db.collection('voters');
  settingsCol  = db.collection('settings');
  partiesCol   = db.collection('parties');
  console.log('✅ MongoDB connected');

  // Asegurar que el documento de configuración existe
  const existing = await settingsCol.findOne({ key: 'election' });
  if (!existing) {
    await settingsCol.insertOne({ key: 'election', active: false });
    console.log('⚙  Settings inicializados (elecciones: inactivas)');
  }
}

// ── DISCORD AUTH ─────────────────────────────────────────────────────────────
app.post('/api/auth/discord', async (req, res) => {
  const { code, redirect_uri } = req.body;
  if (!code || !redirect_uri) return res.status(400).json({ error: 'Missing params' });
  try {
    // node-fetch v3 es ESM; usamos import() dinámico
    const { default: fetch } = await import('node-fetch');

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method : 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body   : new URLSearchParams({
        client_id    : DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type   : 'authorization_code',
        code,
        redirect_uri
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token)
      return res.status(400).json({ error: 'Token exchange failed', detail: tokenData });

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const user = await userRes.json();
    res.json(user);
  } catch (e) {
    console.error('Auth error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── VOTERS — comprobar si ya votó ────────────────────────────────────────────
app.get('/api/voters/check', async (req, res) => {
  try {
    const { discordId } = req.query;
    if (!discordId) return res.status(400).json({ error: 'Missing discordId' });
    const voter = await votersCol.findOne({ discordId });
    if (voter) {
      res.json({ hasVoted: true, partyId: voter.partyId, partyName: voter.partyName });
    } else {
      res.json({ hasVoted: false });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── VOTES — registrar voto ───────────────────────────────────────────────────
app.post('/api/votes', async (req, res) => {
  try {
    const vote = req.body;
    if (!vote.discordId || !vote.partyId)
      return res.status(400).json({ error: 'Missing fields' });

    // Anti-doble voto en base de datos
    const alreadyVoted = await votersCol.findOne({ discordId: vote.discordId });
    if (alreadyVoted)
      return res.status(409).json({ error: 'Ya has votado' });

    // Comprobar que las elecciones están activas
    const settings = await settingsCol.findOne({ key: 'election' });
    if (!settings?.active)
      return res.status(403).json({ error: 'Elecciones no activas' });

    // Guardar voto (solo partyId, sin datos personales) y registro del votante
    await votesCol.insertOne({ partyId: vote.partyId, date: new Date() });
    await votersCol.insertOne({
      discordId      : vote.discordId,
      discordUsername: vote.discordUsername,
      nombre         : vote.nombre,
      apellidos      : vote.apellidos,
      partyId        : vote.partyId,
      partyName      : vote.partyName,
      date           : new Date()
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN — stats completas ──────────────────────────────────────────────────
app.get('/api/admin/stats', async (req, res) => {
  try {
    const votes    = await votesCol.find({}, { projection: { partyId: 1, _id: 0 } }).toArray();
    const voters   = await votersCol.find({}, { projection: { _id: 0 } }).toArray();
    const settings = await settingsCol.findOne({ key: 'election' });
    const parties  = await partiesCol.find({}, { projection: { _id: 0 } }).toArray();

    res.json({
      votes,
      voters,
      electionActive: settings?.active ?? false,
      parties
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN — encender/apagar elecciones ──────────────────────────────────────
app.post('/api/admin/election', async (req, res) => {
  try {
    const { active } = req.body;
    await settingsCol.updateOne(
      { key: 'election' },
      { $set: { active: !!active } },
      { upsert: true }
    );
    console.log(`⚡ Elecciones ${active ? 'ACTIVADAS' : 'DESACTIVADAS'}`);
    res.json({ ok: true, active: !!active });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN — obtener partidos ─────────────────────────────────────────────────
app.get('/api/admin/parties', async (req, res) => {
  try {
    const parties = await partiesCol.find({}, { projection: { _id: 0 } }).toArray();
    res.json(parties);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN — añadir partido ───────────────────────────────────────────────────
app.post('/api/admin/parties', async (req, res) => {
  try {
    const party = req.body;
    if (!party.id || !party.name) return res.status(400).json({ error: 'Missing fields' });
    await partiesCol.insertOne(party);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN — eliminar partido ─────────────────────────────────────────────────
app.delete('/api/admin/parties/:id', async (req, res) => {
  try {
    await partiesCol.deleteOne({ id: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── START ────────────────────────────────────────────────────────────────────
connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`🗳  Server running on http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('❌ DB connection failed:', err.message);
    app.listen(PORT, () => console.log(`🗳  Server running (SIN DB) on http://localhost:${PORT}`));
  });
