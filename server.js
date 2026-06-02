const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const MONGO_URI = 'mongodb+srv://queproficial_db_user:K6SHFRECJHffhZIc@cluster0.t8dr4dl.mongodb.net/?appName=Cluster0';
const DISCORD_CLIENT_ID = '1489699802462687374';
const DISCORD_CLIENT_SECRET = 'gy9YIheksoposj2qQPquN-7iXGgTmQoi';
const PORT = process.env.PORT || 3000;

let votesCol, votersCol, settingsCol, partiesCol;

const DEFAULT_PARTIES = [
  {id:'ppc',name:'PPC',candidate:"N'golo Junqueras",discord:'porrashueleakk',logo:'https://tse1.mm.bing.net/th/id/OIP.DoSKt_oaKzQKsFnGxLW3FgHaHa?r=0&cb=thfvnextfalcon&rs=1&pid=ImgDetMain&o=7&rm=3',color:'#0070C0'},
  {id:'fejons',name:'FEJONS',candidate:'Alfonso Hernández Matamoros',discord:'maruja',logo:'https://images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com/f/beebaf4c-666a-47bc-9a26-d32daa10abb8/dfv2crz-a1e56455-f869-4a27-8ceb-db14bd0051aa.png?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1cm46YXBwOjdlMGQxODg5ODIyNjQzNzNhNWYwZDQxNWVhMGQyNmUwIiwiaXNzIjoidXJuOmFwcDo3ZTBkMTg4OTgyMjY0MzczYTVmMGQ0MTVlYTBkMjZlMCIsIm9iaiI6W1t7InBhdGgiOiJcL2ZcL2JlZWJhZjRjLTY2NmEtNDdiYy05YTI2LWQzMmRhYTEwYWJiOFwvZGZ2MmNyei1hMWU1NjQ1NS1mODY5LTRhMjctOGNlYi1kYjE0YmQwMDUxYWEucG5nIn1dXSwiYXVkIjpbInVybjpzZXJ2aWNlOmZpbGUuZG93bmxvYWQiXX0.Cd02QBDmNxwRtXJRA44T0LVLp_kQ0cfFHjL39GMlmA4',color:'#28A745'},
  {id:'cup',name:'CUP',candidate:'Carlos Jiménez Villarejo',discord:'veuert',logo:'https://tse2.mm.bing.net/th/id/OIP.x2nx4eP1wuZqcde3a9tMcgHaHa?r=0&cb=thfvnextfalcon&rs=1&pid=ImgDetMain&o=7&rm=3',color:'#DC1F26'},
  {id:'pcc',name:'PCC',candidate:'remax_dc',discord:'remax_dc',logo:'https://media.discordapp.net/attachments/1489954017495748649/1511070865826123936/image.png?ex=6a1f1de8&is=6a1dcc68&hm=37895c65f6fb6f7cb0dd717a0be21387285498b9cda163258ce66e3a235bbc29&=&format=webp&quality=lossless',color:'#B71C1C'},
  {id:'vox',name:'VOX',candidate:'Marco Volter',discord:'lukis._',logo:'https://tse1.mm.bing.net/th/id/OIP.nWbRVUu6vsfzKwNioPEeGQAAAA?r=0&cb=thfvnextfalcon&rs=1&pid=ImgDetMain&o=7&rm=3',color:'#5DC837'},
  {id:'junts',name:'JuntsXCat',candidate:'Carles Bancs',discord:'sobejano_44288',logo:'https://static.wikia.nocookie.net/spe/images/3/30/Junts.png/revision/latest?cb=20230910162339&path-prefix=es',color:'#003DA5'},
  {id:'salf',name:'SALF',candidate:'Jorge Manuel Rodríguez',discord:'foxigamerpro24',logo:'https://tse1.mm.bing.net/th/id/OIP.qxXw7-7UNsKfZRVIra_kAgHaHa?r=0&cb=thfvnextfalcon&rs=1&pid=ImgDetMain&o=7&rm=3',color:'#FF6F00'}
];

// ── DB CONNECT ────────────────────────────────
async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('elections_sb');
  votesCol    = db.collection('votes');
  votersCol   = db.collection('voters');
  settingsCol = db.collection('settings');
  partiesCol  = db.collection('parties');
  console.log('✅ MongoDB connected');

  // Settings iniciales
  const cfg = await settingsCol.findOne({ key: 'election' });
  if (!cfg) await settingsCol.insertOne({ key: 'election', active: false });

  // Partidos iniciales
  const pc = await partiesCol.countDocuments();
  if (pc === 0) {
    await partiesCol.insertMany(DEFAULT_PARTIES.map(p => ({ ...p })));
    console.log('✅ Partidos por defecto insertados');
  }
}

// ── AUTH DISCORD ──────────────────────────────
app.post('/api/auth/discord', async (req, res) => {
  const { code, redirect_uri } = req.body;
  if (!code || !redirect_uri) return res.status(400).json({ error: 'Missing params' });
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri })
    });
    const token = await tokenRes.json();
    if (!token.access_token) return res.status(400).json({ error: 'Token failed', detail: token });
    const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    res.json(await userRes.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CHECK ESTADO INICIAL (llamado al cargar la web) ──
// Devuelve: estado elecciones + si este discord ya votó
app.get('/api/status', async (req, res) => {
  try {
    const { discordId } = req.query;
    const cfg = await settingsCol.findOne({ key: 'election' });
    const electionActive = cfg?.active ?? false;
    let voted = null;
    if (discordId) {
      const voter = await votersCol.findOne({ discordId });
      if (voter) {
        voted = { partyId: voter.partyId, partyName: voter.partyName, discordUsername: voter.discordUsername, nombre: voter.nombre, apellidos: voter.apellidos, date: voter.date };
      }
    }
    res.json({ electionActive, voted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PARTIES ───────────────────────────────────
app.get('/api/parties', async (req, res) => {
  try {
    const parties = await partiesCol.find({}, { projection: { _id: 0 } }).toArray();
    res.json(parties);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── VOTE ──────────────────────────────────────
app.post('/api/votes', async (req, res) => {
  try {
    const vote = req.body;
    if (!vote.discordId || !vote.partyId) return res.status(400).json({ error: 'Faltan campos' });

    // Elecciones activas?
    const cfg = await settingsCol.findOne({ key: 'election' });
    if (!cfg?.active) return res.status(403).json({ error: 'Las elecciones no están activas' });

    // Ya votó?
    const exists = await votersCol.findOne({ discordId: vote.discordId });
    if (exists) return res.status(409).json({ error: 'Ya has votado', voted: true });

    await votesCol.insertOne({ partyId: vote.partyId, date: new Date() });
    await votersCol.insertOne({ ...vote, date: new Date() });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN STATS ───────────────────────────────
app.get('/api/admin/stats', async (req, res) => {
  try {
    const votes   = await votesCol.find({}, { projection: { _id: 0, partyId: 1 } }).toArray();
    const voters  = await votersCol.find({}, { projection: { _id: 0 } }).toArray();
    const cfg     = await settingsCol.findOne({ key: 'election' });
    const parties = await partiesCol.find({}, { projection: { _id: 0 } }).toArray();
    res.json({ votes, voters, electionActive: cfg?.active ?? false, parties });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN ELECTION TOGGLE ─────────────────────
app.post('/api/admin/election', async (req, res) => {
  try {
    const { active } = req.body;
    await settingsCol.updateOne({ key: 'election' }, { $set: { active: !!active } }, { upsert: true });
    res.json({ ok: true, active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN PARTIES ─────────────────────────────
app.post('/api/admin/parties', async (req, res) => {
  try {
    await partiesCol.deleteOne({ id: req.body.id });
    await partiesCol.insertOne({ ...req.body });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/parties/:id', async (req, res) => {
  try {
    await partiesCol.deleteOne({ id: req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── START ─────────────────────────────────────
connectDB()
  .then(() => app.listen(PORT, () => console.log(`🗳  http://localhost:${PORT}`)))
  .catch(err => {
    console.error('DB failed:', err.message);
    app.listen(PORT, () => console.log(`🗳  No DB — http://localhost:${PORT}`));
  });
