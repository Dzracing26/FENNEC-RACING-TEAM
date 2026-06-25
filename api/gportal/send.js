const { createClient } = require('@supabase/supabase-js');
const { Client } = require('basic-ftp');
const { Writable } = require('stream');

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

const { type, event_id } = req.body;

if (!event_id) return res.status(400).json({ error: 'event_id requis' });

try {
// ============== RÉSULTATS (récupération FTP GPortal) ==============
if (type === 'results') {
const { data: event, error: errEv } = await supabase
.from('events')
.select('id, event_date, name')
.eq('id', event_id)
.single();

if (errEv || !event) return res.status(404).json({ error: 'Événement introuvable' });

const ftpConfig = {
host: process.env.GPORTAL_FTP_HOST,
port: parseInt(process.env.GPORTAL_FTP_PORT, 10),
user: process.env.GPORTAL_FTP_USER,
password: process.env.GPORTAL_FTP_PASS,
secure: false
};

const client = new Client();
client.ftp.verbose = false;
await client.access(ftpConfig);
const list = await client.list('/results');

const raceFiles = list
.filter(f => f.name.endsWith('_R.json'))
.filter(Boolean)
.sort((a, b) => Math.abs(b.date - event.event_date) - Math.abs(a.date - event.event_date));

if (!raceFiles.length) {
client.close();
return res.status(404).json({ error: 'Aucun fichier de résultats de course trouvé sur le serveur' });
}

const bestFile = raceFiles[0];

const chunks = [];
const writable = new Writable({
write(chunk, encoding, callback) { chunks.push(chunk); callback(); }
});

await client.downloadTo(writable, `/results/${bestFile.name}`);
client.close();

let rawContent = Buffer.concat(chunks).toString('utf-8');
rawContent = rawContent.replace(/^\uFEFF/, '').trim();

// Trouver le premier '{' et le dernier '}'
const startIndex = rawContent.indexOf('{');
const endIndex = rawContent.lastIndexOf('}');

if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
return res.status(400).json({ error: 'No valid JSON object found in file' });
}

rawContent = rawContent.substring(startIndex, endIndex + 1);

let resultData;
try {
resultData = JSON.parse(rawContent);
} catch (parseErr) {
return res.status(400).json({
error: `Fichier JSON invalide: ${parseErr.message}`
});
}

const lines = resultData?.sessionResult?.leaderBoardLines || [];

if (!lines.length) {
return res.status(200).json({ message: 'Fichier trouvé mais aucun classement dedans', file: bestFile.name });
}

const { data: pilots, error: errPilots } = await supabase
.from('pilots')
.select('id, platform_uid');

if (errPilots) return res.status(500).json({ error: errPilots.message });

const pilotsById = {};
(pilots || []).forEach(p => {
if (p.platform_uid) pilotsById[p.platform_uid] = p.id;
});

const rows = lines.map((line, index) => {
const currentDriver = line.currentDriver || '';
const uid = currentDriver.replace(/^[A-Z]_/, '');
const pilotId = pilotsById[uid] || pilotsById[currentDriver] || null;

const totalTimeMs = (line.driverTotalTimes && line.driverTotalTimes[0])
? Math.round(line.driverTotalTimes[0])
: (line.timing?.totalTime ?? null);

const bestLapMs = (line.timing?.bestLap && line.timing.bestLap < 2147483647)
? line.timing.bestLap
: null;

return {
event_id,
pilot_id: pilotId,
result_type: 'race',
position: index + 1,
car_model: String(line.car?.carModel ?? ''),
best_lap_ms: bestLapMs,
total_time_ms: totalTimeMs,
penalty_seconds: 0,
points_earned: 0,
fastest_lap: false,
pole_position: false,
published_at: new Date().toISOString()
};
});

try {
const { error: errInsert } = await supabase.from('results').insert(rows);
if (errInsert) return res.status(500).json({ error: errInsert.message });
} catch (errCatch) {
return res.status(500).json({ error: errCatch.message });
}

return res.status(200).json({
message: `Résultats importés (${rows.length} pilotes)`,
file: bestFile.name,
event: event.name
});
}

// ============== ENTRYLIST / BOP (existant) ==============
if (type === 'entrylist') {
const { data: regs, error: err1 } = await supabase
.from('registrations')
.select('pilot_id')
.eq('event_id', event_id)
.eq('status', 'confirmed');

if (err1) return res.status(500).json({ error: err1.message });
if (!regs.length) return res.status(200).json({ message: 'Aucun pilote inscrit', content: '' });

const pilotIds = regs.map(r => r.pilot_id);

const { data: pilots, error: err2 } = await supabase
.from('pilots')
.select('race_number, psn_id, discord_username, platform_uid, platform, gamertag')
.in('id', pilotIds);

if (err2) return res.status(500).json({ error: err2.message });

const entrylist = {
entries: pilots.map(p => ({
drivers: [
{
playerID: (p.platform === 'xbox' ? 'M' : 'P') + p.platform_uid,
lastName: p.gamertag || p.psn_id || p.discord_username || 'Pilote',
driverCategory: 2
}
],
raceNumber: p.race_number,
forcedCarModel: -1,
overrideDriverInfo: 1,
isServerAdmin: 0,
overrideCarModelForCustomCar: true
})),
forceEntryList: 1
};

return res.status(200).json({
message: 'Entry list générée avec succès !',
content: JSON.stringify(entrylist, null, 2)
});
}

return res.status(400).json({ error: 'Type invalide' });
} catch (e) {
return res.status(500).json({
error: e.message || 'Erreur inconnue',
stack: e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : null,
name: e.name || null
});
}
};
