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

// Partidos por defecto (se insertan en DB si está vacía)
const DEFAULT_PARTIES = [
  { id:'ppc', name:'PPC', fullName:'Partido Popular de Catalunya', candidate:"N'golo Junqueras", discord:'porrashueleakk', logo:'https://tse1.mm.bing.net/th/id/OIP.DoSKt_oaKzQKsFnGxLW3FgHaHa?r=0&cb=thfvnextfalcon&rs=1&pid=ImgDetMain&o=7&rm=3', color:'#0070C0' },
  { id:'fejons', name:'FEJONS', fullName:'Fuerza Electoral de Jóvenes', candidate:'Alfonso Hernández Matamoros', discord:'maruja', logo:'https://images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com/f/beebaf4c-666a-47bc-9a26-d32daa10abb8/dfv2crz-a1e56455-f869-4a27-8ceb-db14bd0051aa.png?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1cm46YXBwOjdlMGQxODg5ODIyNjQzNzNhNWYwZDQxNWVhMGQyNmUwIiwiaXNzIjoidXJuOmFwcDo3ZTBkMTg4OTgyMjY0MzczYTVmMGQ0MTVlYTBkMjZlMCIsIm9iaiI6W1t7InBhdGgiOiJcL2ZcL2JlZWJhZjRjLTY2NmEtNDdiYy05YTI2LWQzMmRhYTEwYWJiOFwvZGZ2MmNyei1hMWU1NjQ1NS1mODY5LTRhMjctOGNlYi1kYjE0YmQwMDUxYWEucG5nIn1dXSwiYXVkIjpbInVybjpzZXJ2aWNlOmZpbGUuZG93bmxvYWQiXX0.Cd02QBDmNxwRtXJRA44T0LVLp_kQ0cfFHjL39GMlmA4', color:'#28A745' },
  { id:'cup', name:'CUP', fullName:"Candidatura d'Unitat Popular", candidate:'Carlos Jiménez Villarejo', discord:'veuert', logo:'https://tse2.mm.bing.net/th/id/OIP.x2nx4eP1wuZqcde3a9tMcgHaHa?r=0&cb=thfvnextfalcon&rs=1&pid=ImgDetMain&o=7&rm=3', color:'#DC1F26' },
  { id:'pcc', name:'PCC', fullName:'Partit Comunista de Catalunya', candidate:'remax_dc', discord:'remax_dc', logo:'https://media.discordapp.net/attachments/1489954017495748649/1511070865826123936/image.png?ex=6a1f1de8&is=6a1dcc68&hm=37895c65f6fb6f7cb0dd717a0be21387285498b9cda163258ce66e3a235bbc29&=&format=webp&quality=lossless', color:'#B71C1C' },
  { id:'vox', name:'VOX', fullName:'VOX', candidate:'Marco Volter', discord:'lukis._', logo:'https://tse1.mm.bing.net/th/id/OIP.nWbRVUu6vsfzKwNioPEeGQAAAA?r=0&cb=thfvnextfalcon&rs=1&pid=ImgDetMain&o=7&rm=3', color:'#5DC837' },
  { id:'junts', name:'JuntsXCat', fullName:'Junts per Catalunya', candidate:'Carles Bancs', discord:'sobejano_44288', logo:'https://static.wikia.nocookie.net/spe/images/3/30/Junts.png/revision/latest?cb=20230910162339&path-prefix=es', color:'#003DA5' },
  { id:'salf', name:'SALF', fullName:'Solidaritat i Avenç per la Llibertat de Catalunya', candidate:'Jorge Manuel Rodríguez', discord:'foxigamerpro24', logo:'https://tse1.mm.bing.net/th/id/OIP.qxXw7-7UNsKfZRVIra_kAgHaHa?r=0&cb=thfvnextfalcon&rs=1&pid=ImgDetMain&o=7&rm=3', color:'#FF6F00' }
];

// ── DATABASE ─────────────────────────────────────────
async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db('elections_sb');
  votesCol    = db.collection('votes');
  votersCol   = db.collection('voters');
  settingsCol = db.collection('settings');
  partiesCol  = db.collection('parties');
  console.log('✅ MongoDB connected');

  // Init settings
  const existing = await settingsCol.findOne({ key: 'election' });
  if (!existing) {
    await settingsCol.insertOne({ key: 'election', active: true });
  }

  // FIX #3: Si no hay partidos en DB, insertar los por defecto
  const partiesCount = await partiesCol.countDocuments();
  if (partiesCount === 0) {
    await partiesCol.insertMany(DEFAULT_PARTIES);
    console.log('✅ Partidos por defecto insertados en MongoDB');
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

    // FIX #1: Comprobación estricta de doble voto en MongoDB
    const exists = await votersCol.findOne({ discordId: vote.discordId });
    if (exists) return res.status(409).json({ error: 'Ya has votado', hasVoted: true, partyId: exists.partyId, partyName: exists.partyName });

    // Comprobar elecciones activas
    const settings = await settingsCol.findOne({ key: 'election' });
    if (!settings?.active) return res.status(403).json({ error: 'Elecciones no activas' });

    await votesCol.insertOne({ partyId: vote.partyId, date: new Date() });
    await votersCol.insertOne({ ...vote, date: new Date() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// FIX #1: Endpoint para comprobar si un Discord ya votó
app.get('/api/voters/check', async (req, res) => {
  try {
    const { discordId } = req.query;
    if (!discordId) return res.status(400).json({ error: 'Missing discordId' });
    const voter = await votersCol.findOne({ discordId });
    if (voter) {
      res.json({ hasVoted: true, partyId: voter.partyId, partyName: voter.partyName, discordUsername: voter.discordUsername, nombre: voter.nombre, apellidos: voter.apellidos, date: voter.date });
    } else {
      res.json({ hasVoted: false });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN ─────────────────────────────────────────────
// FIX #3: stats incluye partidos
app.get('/api/admin/stats', async (req, res) => {
  try {
    const votes    = await votesCol.find({}, { projection: { partyId: 1 } }).toArray();
    const voters   = await votersCol.find({}).toArray();
    const settings = await settingsCol.findOne({ key: 'election' });
    const parties  = await partiesCol.find({}, { projection: { _id: 0 } }).toArray();
    res.json({ votes, voters, electionActive: settings?.active ?? true, parties });
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

// FIX #3: GET partidos devuelve sin _id de Mongo para evitar problemas
app.get('/api/admin/parties', async (req, res) => {
  try {
    const parties = await partiesCol.find({}, { projection: { _id: 0 } }).toArray();
    res.json(parties);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// FIX #3: POST partido guarda en MongoDB
app.post('/api/admin/parties', async (req, res) => {
  try {
    const party = req.body;
    // Evitar duplicados por id
    await partiesCol.deleteOne({ id: party.id });
    await partiesCol.insertOne(party);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// FIX #3: DELETE partido elimina de MongoDB
app.delete('/api/admin/parties/:id', async (req, res) => {
  try {
    const result = await partiesCol.deleteOne({ id: req.params.id });
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── START ─────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🗳  Server running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('DB connection failed:', err.message);
  app.listen(PORT, () => console.log(`🗳  Server running (no DB) on http://localhost:${PORT}`));
});
