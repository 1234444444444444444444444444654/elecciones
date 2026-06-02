const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const app = express();

app.use(cors({
  origin: '*'
}));
app.use(express.json());

const MONGO_URI = 'mongodb+srv://queproficial_db_user:K6SHFRECJHffhZIc@cluster0.t8dr4dl.mongodb.net/?appName=Cluster0';
const DISCORD_CLIENT_ID     = '1489699802462687374';
const DISCORD_CLIENT_SECRET = 'gy9YIheksoposj2qQPquN-7iXGgTmQoi';

let db, votesCol, votersCol, settingsCol, partiesCol;

async function connectDB() {
  if (db) return; // ya conectado
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db          = client.db('elections_sb');
  votesCol    = db.collection('votes');
  votersCol   = db.collection('voters');
  settingsCol = db.collection('settings');
  partiesCol  = db.collection('parties');
  const existing = await settingsCol.findOne({ key: 'election' });
  if (!existing) await settingsCol.insertOne({ key: 'election', active: false });
}

// Middleware que conecta DB antes de cada request
app.use(async (req, res, next) => {
  try { await connectDB(); next(); }
  catch(e) { res.status(500).json({ error: 'DB connection failed' }); }
});

app.post('/api/auth/discord', async (req, res) => {
  const { code, redirect_uri } = req.body;
  if (!code || !redirect_uri) return res.status(400).json({ error: 'Missing params' });
  try {
    const { default: fetch } = await import('node-fetch');
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(400).json({ error: 'Token exchange failed', detail: tokenData });
    const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    res.json(await userRes.json());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/voters/check', async (req, res) => {
  try {
    const { discordId } = req.query;
    if (!discordId) return res.status(400).json({ error: 'Missing discordId' });
    const voter = await votersCol.findOne({ discordId });
    voter ? res.json({ hasVoted: true, partyId: voter.partyId, partyName: voter.partyName })
          : res.json({ hasVoted: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/votes', async (req, res) => {
  try {
    const vote = req.body;
    if (!vote.discordId || !vote.partyId) return res.status(400).json({ error: 'Missing fields' });
    if (await votersCol.findOne({ discordId: vote.discordId })) return res.status(409).json({ error: 'Ya has votado' });
    const settings = await settingsCol.findOne({ key: 'election' });
    if (!settings?.active) return res.status(403).json({ error: 'Elecciones no activas' });
    await votesCol.insertOne({ partyId: vote.partyId, date: new Date() });
    await votersCol.insertOne({ discordId: vote.discordId, discordUsername: vote.discordUsername, nombre: vote.nombre, apellidos: vote.apellidos, partyId: vote.partyId, partyName: vote.partyName, date: new Date() });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const votes    = await votesCol.find({}, { projection: { partyId: 1, _id: 0 } }).toArray();
    const voters   = await votersCol.find({}, { projection: { _id: 0 } }).toArray();
    const settings = await settingsCol.findOne({ key: 'election' });
    const parties  = await partiesCol.find({}, { projection: { _id: 0 } }).toArray();
    res.json({ votes, voters, electionActive: settings?.active ?? false, parties });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/election', async (req, res) => {
  try {
    const { active } = req.body;
    await settingsCol.updateOne({ key: 'election' }, { $set: { active: !!active } }, { upsert: true });
    res.json({ ok: true, active: !!active });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/parties', async (req, res) => {
  try {
    res.json(await partiesCol.find({}, { projection: { _id: 0 } }).toArray());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/parties', async (req, res) => {
  try {
    const party = req.body;
    if (!party.id || !party.name) return res.status(400).json({ error: 'Missing fields' });
    await partiesCol.insertOne(party);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/parties/:id', async (req, res) => {
  try {
    await partiesCol.deleteOne({ id: req.params.id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = app;
